require("dotenv").config();

const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const { randomBytes, scrypt, timingSafeEqual } = require("crypto");
const { promisify } = require("util");

const User = require("./models/User");
const Session = require("./models/Session");
const Worksheet = require("./models/Worksheet");
const Submission = require("./models/Submission");

const scryptAsync = promisify(scrypt);
const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_COOKIE = "mw_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ---------- Passwords ----------

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt, 64);
  return { salt, hash: derivedKey.toString("hex") };
}

async function verifyPassword(password, salt, hash) {
  const derivedKey = await scryptAsync(password, salt, 64);
  const hashBuffer = Buffer.from(hash, "hex");
  if (hashBuffer.length !== derivedKey.length) return false;
  return timingSafeEqual(derivedKey, hashBuffer);
}

// ---------- Cookies & sessions ----------

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(";").forEach(pair => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return cookies;
}

function setSessionCookie(req, res, token) {
  const secure = req.secure || process.env.NODE_ENV === "production";
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

async function createSession(userId) {
  const token = randomBytes(32).toString("hex");
  await Session.create({ token, userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
  return token;
}

async function getSessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const session = await Session.findOne({ token });
  if (!session || session.expiresAt < new Date()) return null;
  return User.findById(session.userId);
}

async function attachUser(req, res, next) {
  try {
    req.user = await getSessionUser(req);
  } catch {
    req.user = null;
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Please log in." });
    if (req.user.role !== role) return res.status(403).json({ message: "Not authorized." });
    next();
  };
}

async function requireWorksheetOwner(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Worksheet not found." });
  const worksheet = await Worksheet.findById(req.params.id);
  if (!worksheet) return res.status(404).json({ message: "Worksheet not found." });
  if (String(worksheet.teacherId) !== String(req.user._id)) {
    return res.status(403).json({ message: "Not authorized." });
  }
  req.worksheet = worksheet;
  next();
}

// ---------- Helpers ----------

function isValidId(id) {
  return mongoose.isValidObjectId(id);
}

function cleanQuestions(questions) {
  if (!Array.isArray(questions) || !questions.length) return null;
  const clean = questions.map((q, i) => ({
    id: q.id || `q${i + 1}`,
    question: String(q.question || "").trim(),
    marks: Number(q.marks) > 0 ? Number(q.marks) : 1,
    guidance: String(q.guidance || "").trim()
  }));
  return clean.some(q => !q.question) ? null : clean;
}

function publicUser(user) {
  return { id: user._id, role: user.role, name: user.name, username: user.username };
}

function weekLabel(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function groupByWeek(dates) {
  const counts = {};
  dates.forEach(date => {
    const label = weekLabel(new Date(date));
    counts[label] = (counts[label] || 0) + 1;
  });
  return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([week, count]) => ({ week, count }));
}

// ---------- App setup ----------

app.use(express.json({ limit: "10mb" }));
app.use(attachUser);

// Close off direct static access to the role-guarded shells.
app.get("/teacher.html", (req, res) => res.redirect("/teacher"));
app.get("/student.html", (req, res) => res.redirect("/student"));

app.get("/teacher", (req, res) => {
  if (!req.user) return res.redirect("/");
  if (req.user.role !== "teacher") return res.redirect("/student");
  res.sendFile(path.join(__dirname, "public", "teacher.html"));
});

app.get("/student", (req, res) => {
  if (!req.user) return res.redirect("/");
  if (req.user.role !== "student") return res.redirect("/teacher");
  res.sendFile(path.join(__dirname, "public", "student.html"));
});

app.use(express.static(path.join(__dirname, "public")));

// ---------- Auth routes ----------
// No self-service registration: accounts are provisioned directly (teachers add
// students from the teacher portal; teacher accounts are added to the database directly).

app.post("/api/auth/login", async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const user = await User.findOne({ username });
  if (!user || !(await verifyPassword(password, user.salt, user.hash))) {
    return res.status(401).json({ message: "Invalid username or password." });
  }

  const token = await createSession(user._id);
  setSessionCookie(req, res, token);
  res.json(publicUser(user));
});

app.post("/api/auth/logout", async (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await Session.deleteOne({ token });
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.user) return res.status(401).json({ message: "Not logged in." });
  res.json(publicUser(req.user));
});

// ---------- Teacher-managed student accounts ----------

app.get("/api/teacher/students", requireRole("teacher"), async (req, res) => {
  const students = await User.find({ role: "student" }).sort({ createdAt: -1 });
  res.json(students.map(publicUser));
});

app.post("/api/teacher/students", requireRole("teacher"), async (req, res) => {
  const name = String(req.body.name || "").trim();
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!name || !username || password.length < 6) {
    return res.status(400).json({ message: "Name, username and a password of at least 6 characters are required." });
  }

  const existing = await User.findOne({ username });
  if (existing) return res.status(409).json({ message: "That username is already taken." });

  const { salt, hash } = await hashPassword(password);
  const student = await User.create({ role: "student", name, username, salt, hash });
  res.status(201).json(publicUser(student));
});

// ---------- Teacher worksheet routes ----------

app.get("/api/teacher/worksheets", requireRole("teacher"), async (req, res) => {
  const worksheets = await Worksheet.find({ teacherId: req.user._id, archived: false }).sort({ createdAt: -1 });
  const counts = await Submission.aggregate([
    { $match: { worksheetId: { $in: worksheets.map(w => w._id) } } },
    { $group: { _id: "$worksheetId", count: { $sum: 1 } } }
  ]);
  const countMap = new Map(counts.map(c => [String(c._id), c.count]));

  res.json(worksheets.map(w => ({
    id: w._id,
    title: w.title,
    topic: w.topic,
    description: w.description,
    questionCount: w.questions.length,
    submissionCount: countMap.get(String(w._id)) || 0,
    createdAt: w.createdAt
  })));
});

app.post("/api/teacher/worksheets", requireRole("teacher"), async (req, res) => {
  const { title, topic = "", description = "" } = req.body;
  const questions = cleanQuestions(req.body.questions);

  if (!String(title || "").trim() || !questions) {
    return res.status(400).json({ message: "Title and at least one question (with text) are required." });
  }

  const worksheet = await Worksheet.create({
    teacherId: req.user._id,
    title: String(title).trim(),
    topic: String(topic).trim(),
    description: String(description).trim(),
    questions
  });
  res.status(201).json(worksheet);
});

app.get("/api/teacher/worksheets/:id", requireRole("teacher"), requireWorksheetOwner, async (req, res) => {
  const submissionCount = await Submission.countDocuments({ worksheetId: req.worksheet._id });
  res.json({ ...req.worksheet.toObject(), submissionCount });
});

app.put("/api/teacher/worksheets/:id", requireRole("teacher"), requireWorksheetOwner, async (req, res) => {
  const submissionCount = await Submission.countDocuments({ worksheetId: req.worksheet._id });
  if (submissionCount > 0) {
    return res.status(409).json({ message: "This worksheet already has submissions — duplicate it instead of editing." });
  }

  const { title, topic, description } = req.body;
  const questions = cleanQuestions(req.body.questions);
  if (!questions) return res.status(400).json({ message: "At least one question (with text) is required." });

  req.worksheet.title = String(title || req.worksheet.title).trim();
  req.worksheet.topic = String(topic ?? req.worksheet.topic).trim();
  req.worksheet.description = String(description ?? req.worksheet.description).trim();
  req.worksheet.questions = questions;
  await req.worksheet.save();
  res.json(req.worksheet);
});

app.delete("/api/teacher/worksheets/:id", requireRole("teacher"), requireWorksheetOwner, async (req, res) => {
  req.worksheet.archived = true;
  await req.worksheet.save();
  res.json({ ok: true });
});

app.post("/api/teacher/worksheets/:id/duplicate", requireRole("teacher"), requireWorksheetOwner, async (req, res) => {
  const copy = await Worksheet.create({
    teacherId: req.user._id,
    title: `${req.worksheet.title} (copy)`,
    topic: req.worksheet.topic,
    description: req.worksheet.description,
    questions: req.worksheet.questions
  });
  res.status(201).json(copy);
});

// ---------- Student worksheet routes ----------

app.get("/api/student/worksheets", requireRole("student"), async (req, res) => {
  const worksheets = await Worksheet.find({ archived: false }).sort({ createdAt: -1 });
  const submissions = await Submission.find({ studentId: req.user._id });
  const byWorksheet = new Map(submissions.map(s => [String(s.worksheetId), s]));

  res.json(worksheets.map(w => {
    const submission = byWorksheet.get(String(w._id));
    return {
      id: w._id,
      title: w.title,
      topic: w.topic,
      description: w.description,
      questionCount: w.questions.length,
      createdAt: w.createdAt,
      status: submission ? submission.status : "not-started",
      percentage: submission && submission.status === "graded" ? submission.percentage : null,
      submissionId: submission ? submission._id : null
    };
  }));
});

app.get("/api/student/worksheets/:id", requireRole("student"), async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ message: "Worksheet not found." });
  const worksheet = await Worksheet.findOne({ _id: req.params.id, archived: false });
  if (!worksheet) return res.status(404).json({ message: "Worksheet not found." });

  res.json({
    id: worksheet._id,
    title: worksheet.title,
    topic: worksheet.topic,
    description: worksheet.description,
    questions: worksheet.questions.map(({ id, question, marks }) => ({ id, question, marks })),
    createdAt: worksheet.createdAt
  });
});

app.post("/api/student/worksheets/:id/submit", requireRole("student"), async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ message: "Worksheet not found." });
  const worksheet = await Worksheet.findOne({ _id: req.params.id, archived: false });
  if (!worksheet) return res.status(404).json({ message: "Worksheet not found." });

  const existing = await Submission.findOne({ worksheetId: worksheet._id, studentId: req.user._id });
  if (existing) return res.status(409).json({ message: "You have already submitted this worksheet." });

  const answers = req.body.answers || {};
  const rawTime = Number(req.body.timeSpentSeconds);
  const timeSpentSeconds = Number.isFinite(rawTime) ? Math.max(0, Math.round(rawTime)) : 0;
  const totalMarks = worksheet.questions.reduce((sum, q) => sum + q.marks, 0);
  const review = worksheet.questions.map(q => {
    const raw = answers[q.id] || {};
    const drawing = typeof raw.drawing === "string" && raw.drawing.startsWith("data:image") ? raw.drawing : null;
    return {
      questionId: q.id,
      question: q.question,
      studentAnswerText: String(raw.text || "").trim(),
      studentAnswerDrawing: drawing,
      marks: q.marks,
      awardedMarks: null,
      correct: null,
      feedback: ""
    };
  });

  try {
    const submission = await Submission.create({
      worksheetId: worksheet._id,
      worksheetTitle: worksheet.title,
      worksheetTopic: worksheet.topic,
      studentId: req.user._id,
      studentName: req.user.name,
      answers,
      status: "submitted",
      review,
      totalMarks,
      timeSpentSeconds
    });
    res.status(201).json(submission);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: "You have already submitted this worksheet." });
    throw err;
  }
});

// ---------- Teacher grading routes ----------

app.get("/api/teacher/submissions", requireRole("teacher"), async (req, res) => {
  const worksheetIds = await Worksheet.find({ teacherId: req.user._id }).distinct("_id");
  const filter = { worksheetId: { $in: worksheetIds } };
  if (req.query.worksheetId && isValidId(req.query.worksheetId)) filter.worksheetId = req.query.worksheetId;
  if (req.query.status === "submitted" || req.query.status === "graded") filter.status = req.query.status;

  const submissions = await Submission.find(filter).sort({ submittedAt: -1 });
  res.json(submissions.map(s => ({
    id: s._id,
    worksheetId: s.worksheetId,
    worksheetTitle: s.worksheetTitle,
    studentName: s.studentName,
    status: s.status,
    percentage: s.percentage,
    timeSpentSeconds: s.timeSpentSeconds,
    submittedAt: s.submittedAt,
    gradedAt: s.gradedAt
  })));
});

app.get("/api/teacher/submissions/:id", requireRole("teacher"), async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ message: "Submission not found." });
  const submission = await Submission.findById(req.params.id);
  if (!submission) return res.status(404).json({ message: "Submission not found." });

  const worksheet = await Worksheet.findById(submission.worksheetId);
  if (!worksheet || String(worksheet.teacherId) !== String(req.user._id)) {
    return res.status(403).json({ message: "Not authorized." });
  }

  const guidanceByQuestion = new Map(worksheet.questions.map(q => [q.id, q.guidance]));
  const submissionJson = submission.toJSON();
  submissionJson.review = submissionJson.review.map(item => ({
    ...item,
    guidance: guidanceByQuestion.get(item.questionId) || ""
  }));
  res.json(submissionJson);
});

app.post("/api/teacher/submissions/:id/grade", requireRole("teacher"), async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ message: "Submission not found." });
  const submission = await Submission.findById(req.params.id);
  if (!submission) return res.status(404).json({ message: "Submission not found." });

  const worksheet = await Worksheet.findById(submission.worksheetId);
  if (!worksheet || String(worksheet.teacherId) !== String(req.user._id)) {
    return res.status(403).json({ message: "Not authorized." });
  }

  const inputByQuestion = new Map((req.body.review || []).map(item => [item.questionId, item]));
  let earnedMarks = 0;

  submission.review = submission.review.map(item => {
    const input = inputByQuestion.get(item.questionId);
    if (!input) return item;
    const awardedMarks = Math.max(0, Math.min(item.marks, Number(input.awardedMarks) || 0));
    earnedMarks += awardedMarks;
    return {
      ...item.toObject(),
      correct: Boolean(input.correct),
      awardedMarks,
      feedback: String(input.feedback || "").trim()
    };
  });

  submission.earnedMarks = earnedMarks;
  submission.percentage = submission.totalMarks ? Math.round((earnedMarks / submission.totalMarks) * 100) : 0;
  submission.overallFeedback = String(req.body.overallFeedback || "").trim();
  submission.status = "graded";
  submission.gradedAt = new Date();
  submission.gradedBy = req.user._id;

  await submission.save();
  res.json(submission);
});

// ---------- Student submission routes ----------

app.get("/api/student/submissions", requireRole("student"), async (req, res) => {
  const submissions = await Submission.find({ studentId: req.user._id }).sort({ submittedAt: -1 });
  res.json(submissions.map(s => ({
    id: s._id,
    worksheetId: s.worksheetId,
    worksheetTitle: s.worksheetTitle,
    worksheetTopic: s.worksheetTopic,
    status: s.status,
    percentage: s.percentage,
    submittedAt: s.submittedAt,
    gradedAt: s.gradedAt
  })));
});

app.get("/api/student/submissions/:id", requireRole("student"), async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ message: "Submission not found." });
  const submission = await Submission.findOne({ _id: req.params.id, studentId: req.user._id });
  if (!submission) return res.status(404).json({ message: "Submission not found." });
  res.json(submission);
});

// ---------- Stats ----------

app.get("/api/student/stats", requireRole("student"), async (req, res) => {
  const [totalWorksheets, submissions] = await Promise.all([
    Worksheet.countDocuments({ archived: false }),
    Submission.find({ studentId: req.user._id }).sort({ submittedAt: 1 })
  ]);

  const graded = submissions.filter(s => s.status === "graded");
  const submittedCount = submissions.filter(s => s.status === "submitted").length;
  const notStarted = Math.max(0, totalWorksheets - submissions.length);

  const scoreTrend = graded.map(s => ({
    label: s.worksheetTitle,
    date: s.gradedAt,
    percentage: s.percentage,
    earnedMarks: s.earnedMarks,
    totalMarks: s.totalMarks
  }));

  const topicTotals = new Map();
  graded.forEach(s => {
    const topic = s.worksheetTopic || "General";
    if (!topicTotals.has(topic)) topicTotals.set(topic, []);
    topicTotals.get(topic).push(s.percentage);
  });
  const averageByTopic = [...topicTotals.entries()].map(([topic, values]) => ({
    topic,
    average: Math.round(values.reduce((a, b) => a + b, 0) / values.length)
  }));

  const activityByWeek = groupByWeek(submissions.map(s => s.submittedAt));

  let correctCount = 0;
  let needsReviewCount = 0;
  graded.forEach(s => s.review.forEach(item => {
    if (item.correct === true) correctCount += 1;
    else if (item.correct === false) needsReviewCount += 1;
  }));

  const accuracyBuckets = new Map();
  graded.forEach(s => {
    const week = weekLabel(new Date(s.gradedAt));
    if (!accuracyBuckets.has(week)) accuracyBuckets.set(week, { correct: 0, total: 0 });
    const bucket = accuracyBuckets.get(week);
    s.review.forEach(item => {
      if (item.correct === null) return;
      bucket.total += 1;
      if (item.correct) bucket.correct += 1;
    });
  });
  const accuracyByWeek = [...accuracyBuckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, b]) => ({ week, percentage: b.total ? Math.round((b.correct / b.total) * 100) : 0 }));

  res.json({
    statusBreakdown: { notStarted, submitted: submittedCount, graded: graded.length },
    scoreTrend,
    averageByTopic,
    activityByWeek,
    accuracyByWeek,
    correctRatio: { correct: correctCount, needsReview: needsReviewCount }
  });
});

app.get("/api/teacher/stats", requireRole("teacher"), async (req, res) => {
  const worksheets = await Worksheet.find({ teacherId: req.user._id });
  const worksheetIds = worksheets.map(w => w._id);
  const submissions = await Submission.find({ worksheetId: { $in: worksheetIds } });
  const graded = submissions.filter(s => s.status === "graded");

  const averagePerWorksheet = worksheets.map(w => {
    const scores = graded.filter(s => String(s.worksheetId) === String(w._id)).map(s => s.percentage);
    return {
      title: w.title,
      average: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      gradedCount: scores.length
    };
  }).filter(w => w.gradedCount > 0);

  const queueBreakdown = {
    pending: submissions.filter(s => s.status === "submitted").length,
    graded: graded.length
  };

  const bins = Array.from({ length: 10 }, (_, i) => ({ range: `${i * 10}-${i * 10 + 9}`, count: 0 }));
  graded.forEach(s => {
    const index = Math.min(9, Math.floor(s.percentage / 10));
    bins[index].count += 1;
  });

  const submissionsOverTime = groupByWeek(submissions.map(s => s.submittedAt));

  const questionStats = new Map();
  graded.forEach(s => s.review.forEach(item => {
    const key = item.questionId + "::" + item.question;
    if (!questionStats.has(key)) questionStats.set(key, { question: item.question, attempts: 0, incorrect: 0 });
    const entry = questionStats.get(key);
    entry.attempts += 1;
    if (item.correct === false) entry.incorrect += 1;
  }));
  const mostMissed = [...questionStats.values()]
    .filter(q => q.attempts >= 3)
    .sort((a, b) => b.incorrect - a.incorrect)
    .slice(0, 8);

  res.json({
    averagePerWorksheet,
    queueBreakdown,
    scoreDistribution: bins,
    submissionsOverTime,
    mostMissed
  });
});

// ---------- Errors ----------

app.use((err, req, res, next) => {
  if (err && err.code === 11000) {
    return res.status(409).json({ message: "That value is already taken." });
  }
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ message: "That answer is too large — try a smaller or simpler drawing." });
  }
  console.error(err);
  res.status(500).json({ message: "Something went wrong." });
});

// ---------- Boot ----------

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`MathWorks is running at http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1);
  });
