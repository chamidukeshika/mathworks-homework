let questions = [];
let editingIndex = null;
let editingWorksheetId = null;
let queueFilter = { worksheetId: "", status: "" };

const el = id => document.getElementById(id);
const views = {
  dashboard: el("dashboardView"),
  builder: el("builderView"),
  worksheets: el("worksheetsView"),
  queue: el("queueView"),
  students: el("studentsView"),
  detail: el("detailView")
};
const charts = {};
let currentUser = null;

function toast(message) {
  const t = el("toast");
  t.textContent = message;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
}
function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}
function typeset() {
  if (window.MathJax?.typesetPromise) {
    window.MathJax.typesetClear?.();
    window.MathJax.typesetPromise().catch(() => {});
  }
}
function fmtDate(value) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}
function fmtDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
function renderAnswerContent(item) {
  const text = (item.studentAnswerText || "").trim();
  const drawing = item.studentAnswerDrawing;
  if (!text && !drawing) return `<div class="student-answer-text">No answer given</div>`;
  return `
    ${text ? `${drawing ? `<div class="answer-part-label">⌨ Typed</div>` : ""}<div class="student-answer-text">${escapeHtml(text)}</div>` : ""}
    ${drawing ? `${text ? `<div class="answer-part-label">✏ Drawn</div>` : ""}<img class="drawn-answer-image" src="${drawing}" alt="Student's drawn answer">` : ""}
  `;
}

async function api(path, options) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  let data = {};
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new Error(data.message || "Something went wrong.");
  return data;
}

function switchView(name) {
  Object.entries(views).forEach(([key, node]) => node.style.display = key === name ? "" : "none");
  document.querySelectorAll(".nav-item[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  if (name === "dashboard") loadDashboard();
  if (name === "builder" && editingWorksheetId === null) resetBuilder();
  if (name === "worksheets") loadWorksheets();
  if (name === "queue") loadQueue();
  if (name === "students") loadStudents();
}
function switchViewSilent(name) {
  Object.entries(views).forEach(([key, node]) => node.style.display = key === name ? "" : "none");
}

function openBuilder() {
  editingWorksheetId = null;
  switchView("builder");
}

document.querySelectorAll(".nav-item[data-view]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.dataset.view === "builder") editingWorksheetId = null;
    switchView(btn.dataset.view);
  });
});

el("logoutBtn").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  location.href = "/";
});

// ---------- Charts ----------

const PALETTE = {
  violet: "#4a3aa7", blue: "#2a78d6", orange: "#eb6834", serious: "#ec835a",
  success: "#0ca30c", danger: "#d03b3b", warning: "#f0a500", grid: "#eceefa"
};

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}
function chartCard({ id, title, sub, empty, emptyMessage, icon = "📊", iconBg = "var(--primary-soft)", iconColor = "var(--primary-dark)" }) {
  return `
    <div class="chart-card">
      <div class="chart-card-head">
        <div class="chart-icon" style="background:${iconBg};color:${iconColor}">${icon}</div>
        <h3>${escapeHtml(title)}</h3>
      </div>
      <div class="chart-sub">${escapeHtml(sub)}</div>
      ${empty ? `<div class="chart-empty"><span style="font-size:22px">🌱</span>${escapeHtml(emptyMessage)}</div>` : `<div class="chart-wrap"><canvas id="${id}"></canvas></div>`}
    </div>
  `;
}
function baseOptions(extra = {}) {
  return { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 }, usePointStyle: true, pointStyle: "circle" } } }, ...extra };
}
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ---------- Dashboard ----------

async function loadDashboard() {
  const section = views.dashboard;
  const firstName = currentUser ? escapeHtml(currentUser.name.split(" ")[0]) : "";
  section.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Overview</div><h1>${greeting()}${firstName ? ", " + firstName : ""} 👋</h1><p class="sub">See engagement and performance across all your worksheets.</p></div>
      <button class="btn btn-primary" onclick="openBuilder()">+ New worksheet</button>
    </div>
    <div class="grid grid-auto" id="statTiles" style="margin-bottom:18px"></div>
    <div class="chart-grid" id="chartGrid"></div>
  `;

  let stats;
  try { stats = await api("/api/teacher/stats"); }
  catch { section.querySelector("#chartGrid").innerHTML = `<div class="empty">Could not load stats.</div>`; return; }

  const gradedAverages = stats.averagePerWorksheet.map(w => w.average).filter(v => v != null);
  const overallAvg = gradedAverages.length ? Math.round(gradedAverages.reduce((a, b) => a + b, 0) / gradedAverages.length) : 0;

  el("statTiles").innerHTML = `
    <div class="stat"><div class="stat-icon" style="background:var(--warning-soft);color:#96700a">⏳</div><div class="stat-body"><div class="stat-value">${stats.queueBreakdown.pending}</div><div class="stat-label">Awaiting your review</div></div></div>
    <div class="stat"><div class="stat-icon" style="background:var(--success-soft);color:var(--success)">✓</div><div class="stat-body"><div class="stat-value">${stats.queueBreakdown.graded}</div><div class="stat-label">Graded submissions</div></div></div>
    <div class="stat"><div class="stat-icon" style="background:var(--accent-violet-soft);color:var(--accent-violet)">★</div><div class="stat-body"><div class="stat-value">${overallAvg}%</div><div class="stat-label">Average class score</div></div></div>
  `;

  const grid = el("chartGrid");
  grid.innerHTML =
    chartCard({ id: "avgChart", title: "Average score per worksheet", sub: "Graded submissions only", empty: !stats.averagePerWorksheet.length, emptyMessage: "Grade some submissions to see this.", icon: "📈", iconBg: "var(--accent-violet-soft)", iconColor: "var(--accent-violet)" }) +
    chartCard({ id: "queueChart", title: "Grading queue", sub: "Pending vs graded", empty: (stats.queueBreakdown.pending + stats.queueBreakdown.graded) === 0, emptyMessage: "No submissions yet.", icon: "🗂️", iconBg: "var(--warning-soft)", iconColor: "#96700a" }) +
    chartCard({ id: "distChart", title: "Score distribution", sub: "Across all graded submissions", empty: !stats.scoreDistribution.some(b => b.count > 0), emptyMessage: "No graded submissions yet.", icon: "📊", iconBg: "var(--accent-blue-soft)", iconColor: "var(--accent-blue)" }) +
    chartCard({ id: "timeChart", title: "Submissions over time", sub: "Per week, all worksheets", empty: !stats.submissionsOverTime.length, emptyMessage: "No submissions yet.", icon: "🔥", iconBg: "var(--accent-orange-soft)", iconColor: "var(--accent-orange)" }) +
    chartCard({ id: "missedChart", title: "Most-missed questions", sub: "Questions with 3+ attempts, most incorrect first", empty: !stats.mostMissed.length, emptyMessage: "Not enough graded data yet.", icon: "⚠️", iconBg: "var(--serious-soft)", iconColor: "var(--serious)" });

  ["avg", "queue", "dist", "time", "missed"].forEach(destroyChart);

  if (stats.averagePerWorksheet.length) {
    charts.avg = new Chart(el("avgChart"), {
      type: "bar",
      data: { labels: stats.averagePerWorksheet.map(w => w.title.length > 16 ? w.title.slice(0, 16) + "…" : w.title), datasets: [{ label: "Average %", data: stats.averagePerWorksheet.map(w => w.average), backgroundColor: PALETTE.violet, borderRadius: 8, maxBarThickness: 46 }] },
      options: baseOptions({ plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, grid: { color: PALETTE.grid } }, x: { grid: { display: false } } } })
    });
  }

  if (stats.queueBreakdown.pending + stats.queueBreakdown.graded > 0) {
    charts.queue = new Chart(el("queueChart"), {
      type: "doughnut",
      data: { labels: ["Pending", "Graded"], datasets: [{ data: [stats.queueBreakdown.pending, stats.queueBreakdown.graded], backgroundColor: [PALETTE.warning, PALETTE.success], borderWidth: 3, borderColor: "#fff" }] },
      options: baseOptions({ cutout: "66%" })
    });
  }

  if (stats.scoreDistribution.some(b => b.count > 0)) {
    charts.dist = new Chart(el("distChart"), {
      type: "bar",
      data: { labels: stats.scoreDistribution.map(b => b.range), datasets: [{ label: "Submissions", data: stats.scoreDistribution.map(b => b.count), backgroundColor: PALETTE.blue, borderRadius: 6, maxBarThickness: 36 }] },
      options: baseOptions({ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: PALETTE.grid } }, x: { grid: { display: false } } } })
    });
  }

  if (stats.submissionsOverTime.length) {
    charts.time = new Chart(el("timeChart"), {
      type: "bar",
      data: { labels: stats.submissionsOverTime.map(w => fmtDate(w.week)), datasets: [{ label: "Submissions", data: stats.submissionsOverTime.map(w => w.count), backgroundColor: PALETTE.orange, borderRadius: 8, maxBarThickness: 46 }] },
      options: baseOptions({ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: PALETTE.grid } }, x: { grid: { display: false } } } })
    });
  }

  if (stats.mostMissed.length) {
    charts.missed = new Chart(el("missedChart"), {
      type: "bar",
      data: {
        labels: stats.mostMissed.map(q => q.question.length > 28 ? q.question.slice(0, 28) + "…" : q.question),
        datasets: [{ label: "Incorrect", data: stats.mostMissed.map(q => q.incorrect), backgroundColor: PALETTE.serious, borderRadius: 6, maxBarThickness: 26 }]
      },
      options: baseOptions({ indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: PALETTE.grid } }, y: { grid: { display: false } } } })
    });
  }
}

// ---------- Builder ----------

function resetBuilder() {
  editingWorksheetId = null;
  questions = [];
  views.builder.innerHTML = builderTemplate();
  wireBuilder();
  renderQuestions();
}

function builderTemplate() {
  return `
    <div class="page-head">
      <div><div class="eyebrow">Teacher</div><h1 id="builderHeading">Create a worksheet</h1><p class="sub">Add written-answer questions — students show full working, you grade by hand.</p></div>
      <button id="saveWorksheetBtn" class="btn btn-primary">Publish worksheet</button>
    </div>
    <div class="grid grid-2">
      <section class="card">
        <div class="card-head"><h2>Worksheet details</h2><span class="badge" id="questionCountBadge">0 questions</span></div>
        <div class="field"><label for="worksheetTitle">Title</label><input class="input" id="worksheetTitle" placeholder="e.g. Linear Equations — Practice"></div>
        <div class="inline-fields">
          <div class="field"><label for="worksheetTopic">Topic</label><input class="input" id="worksheetTopic" placeholder="e.g. Linear equations"></div>
          <div class="field"><label for="worksheetDescription">Class / note</label><input class="input" id="worksheetDescription" placeholder="e.g. Grade 8 — Homework 04"></div>
        </div>
        <div class="divider"></div>
        <div class="card-head"><h2>Questions</h2><button id="addQuestionBtn" class="btn btn-secondary btn-sm">+ Add question</button></div>
        <div id="questionList" class="question-list"></div>
        <div class="divider"></div>
        <div class="card-head"><h3>Import question bundle</h3><button id="loadExampleBtn" class="btn btn-ghost btn-sm">Use algebra example</button></div>
        <div class="field">
          <label for="jsonInput">JSON</label>
          <textarea id="jsonInput" placeholder='[
  {"question":"Solve for x: 2x + 6 = 14","marks":2},
  {"question":"Simplify: 3(x + 4) - 2x","marks":2,"guidance":"Expect 3x+12-2x = x+12"}
]'></textarea>
          <div class="help">Supported fields: question, marks and guidance (private grading note).</div>
        </div>
        <button id="importJsonBtn" class="btn btn-secondary">Import JSON</button>
      </section>
      <section class="card">
        <div class="card-head"><h2>Live preview</h2><span class="help">Student view</span></div>
        <div id="preview" class="preview-wrap"></div>
      </section>
    </div>
  `;
}

function wireBuilder() {
  el("saveWorksheetBtn").addEventListener("click", saveWorksheet);
  el("addQuestionBtn").addEventListener("click", () => { resetQuestionModal(); openQuestionModal(); });
  el("loadExampleBtn").addEventListener("click", loadExample);
  el("importJsonBtn").addEventListener("click", importJson);
  ["worksheetTitle", "worksheetTopic", "worksheetDescription"].forEach(id => {
    el(id).addEventListener("input", () => { renderPreview(); typeset(); });
  });
}

function renderQuestions() {
  el("questionCountBadge").textContent = `${questions.length} question${questions.length === 1 ? "" : "s"}`;
  const list = el("questionList");

  if (!questions.length) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">✦</div><strong>No questions yet</strong><div class="help" style="margin-top:6px">Add one manually or import a JSON bundle below.</div></div>`;
  } else {
    list.innerHTML = questions.map((q, i) => `
      <div class="question-row">
        <div class="q-num">${i + 1}</div>
        <div>
          <div class="q-title">${escapeHtml(q.question)}</div>
          <div class="q-meta">${q.marks} mark${q.marks === 1 ? "" : "s"}${q.guidance ? " • has grading guidance" : ""}</div>
        </div>
        <div class="q-actions">
          <button class="btn btn-ghost btn-sm" onclick="editQuestion(${i})">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="removeQuestion(${i})">×</button>
        </div>
      </div>
    `).join("");
  }
  renderPreview();
  typeset();
}

function renderPreview() {
  const title = el("worksheetTitle").value.trim() || "Untitled worksheet";
  const topic = el("worksheetTopic").value.trim() || "Math practice";
  const preview = el("preview");

  if (!questions.length) {
    preview.innerHTML = `
      <div class="preview-title"><div class="eyebrow">${escapeHtml(topic)}</div><h3 style="margin:5px 0">${escapeHtml(title)}</h3></div>
      <div class="preview-body"><div class="empty">Your student preview will appear here.</div></div>
    `;
    return;
  }

  preview.innerHTML = `
    <div class="preview-title"><div class="eyebrow">${escapeHtml(topic)}</div><h3 style="margin:5px 0">${escapeHtml(title)}</h3><div class="help">${questions.length} questions</div></div>
    <div class="preview-body">
      ${questions.map((q, i) => `
        <div class="preview-question">
          <div style="font-weight:750">${i + 1}. ${escapeHtml(q.question)} <span class="help">(${q.marks} mark${q.marks === 1 ? "" : "s"})</span></div>
          <div class="answer-demo"></div>
        </div>
      `).join("")}
    </div>
  `;
}

function resetQuestionModal() {
  editingIndex = null;
  el("modalTitle").textContent = "Add question";
  el("qText").value = "";
  el("qMarks").value = "1";
  el("qGuidance").value = "";
}
function openQuestionModal() {
  el("questionModal").classList.add("open");
  setTimeout(() => el("qText").focus(), 50);
}
function closeQuestionModal() { el("questionModal").classList.remove("open"); }

el("closeQuestionModal").addEventListener("click", closeQuestionModal);
el("cancelQuestionBtn").addEventListener("click", closeQuestionModal);
el("questionModal").addEventListener("click", e => { if (e.target === el("questionModal")) closeQuestionModal(); });

window.editQuestion = function (index) {
  const q = questions[index];
  editingIndex = index;
  el("modalTitle").textContent = "Edit question";
  el("qText").value = q.question || "";
  el("qMarks").value = q.marks || 1;
  el("qGuidance").value = q.guidance || "";
  openQuestionModal();
};
window.removeQuestion = function (index) { questions.splice(index, 1); renderQuestions(); };

el("saveQuestionBtn").addEventListener("click", () => {
  const question = el("qText").value.trim();
  const marks = Number(el("qMarks").value) || 1;
  const guidance = el("qGuidance").value.trim();
  if (!question) return toast("Add the question text.");

  const item = { question, marks, guidance };
  if (editingIndex === null) questions.push(item);
  else questions[editingIndex] = item;
  closeQuestionModal();
  renderQuestions();
});

const algebraExample = [
  { question: "Solve for x: \\(2x + 6 = 14\\). Show every step.", marks: 2, guidance: "2x=8 → x=4" },
  { question: "Simplify: \\(3(x + 4) - 2x\\)", marks: 2, guidance: "3x+12-2x = x+12" },
  { question: "A rectangle has length \\(2x+3\\) and width \\(x\\). Write and simplify an expression for its perimeter.", marks: 3, guidance: "P=2(2x+3)+2x = 6x+6" },
  { question: "Solve the system: \\(x+y=10\\), \\(x-y=2\\). Show your method.", marks: 3, guidance: "x=6, y=4" },
  { question: "Factorise: \\(x^2 + 7x + 12\\)", marks: 2, guidance: "(x+3)(x+4)" }
];

function loadExample() {
  el("worksheetTitle").value = "Linear Equations — Practice Worksheet";
  el("worksheetTopic").value = "Linear equations";
  el("worksheetDescription").value = "Grade 8 — Homework";
  el("jsonInput").value = JSON.stringify(algebraExample, null, 2);
  questions = JSON.parse(JSON.stringify(algebraExample));
  renderQuestions();
  toast("Algebra example loaded.");
}

function importJson() {
  try {
    const parsed = JSON.parse(el("jsonInput").value);
    if (!Array.isArray(parsed)) throw new Error("JSON must be an array");
    const clean = parsed.map(q => ({
      question: String(q.question || "").trim(),
      marks: Number(q.marks) > 0 ? Number(q.marks) : 1,
      guidance: String(q.guidance || "").trim()
    }));
    if (clean.some(q => !q.question)) throw new Error("Every question needs question text");
    questions = clean;
    renderQuestions();
    toast(`${clean.length} questions imported.`);
  } catch (err) {
    toast(`JSON error: ${err.message}`);
  }
}

async function saveWorksheet() {
  const title = el("worksheetTitle").value.trim();
  if (!title) return toast("Add a worksheet title.");
  if (!questions.length) return toast("Add at least one question.");

  const btn = el("saveWorksheetBtn");
  btn.disabled = true;
  btn.textContent = editingWorksheetId ? "Saving..." : "Publishing...";

  const payload = {
    title,
    topic: el("worksheetTopic").value.trim(),
    description: el("worksheetDescription").value.trim(),
    questions
  };

  try {
    if (editingWorksheetId) {
      await api(`/api/teacher/worksheets/${editingWorksheetId}`, { method: "PUT", body: JSON.stringify(payload) });
      toast("Worksheet updated.");
    } else {
      await api("/api/teacher/worksheets", { method: "POST", body: JSON.stringify(payload) });
      toast("Worksheet published — every student can see it now.");
    }
    editingWorksheetId = null;
    switchView("worksheets");
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Publish worksheet";
  }
}

window.editWorksheet = async function (id) {
  let worksheet;
  try { worksheet = await api(`/api/teacher/worksheets/${id}`); }
  catch (err) { return toast(err.message); }

  if (worksheet.submissionCount > 0) return toast("This worksheet has submissions — duplicate it instead of editing.");

  editingWorksheetId = id;
  questions = worksheet.questions.map(q => ({ question: q.question, marks: q.marks, guidance: q.guidance }));
  switchViewSilent("builder");
  document.querySelectorAll(".nav-item[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === "builder"));
  views.builder.innerHTML = builderTemplate();
  wireBuilder();
  el("builderHeading").textContent = "Edit worksheet";
  el("saveWorksheetBtn").textContent = "Save changes";
  el("worksheetTitle").value = worksheet.title;
  el("worksheetTopic").value = worksheet.topic;
  el("worksheetDescription").value = worksheet.description;
  renderQuestions();
};

window.duplicateWorksheet = async function (id) {
  try {
    await api(`/api/teacher/worksheets/${id}/duplicate`, { method: "POST" });
    toast("Worksheet duplicated — edit the copy freely.");
    loadWorksheets();
  } catch (err) { toast(err.message); }
};

window.archiveWorksheet = async function (id) {
  if (!confirm("Archive this worksheet? Students will no longer see it, but past submissions stay on record.")) return;
  await api(`/api/teacher/worksheets/${id}`, { method: "DELETE" });
  toast("Worksheet archived.");
  loadWorksheets();
};

// ---------- My Worksheets ----------

async function loadWorksheets() {
  const section = views.worksheets;
  section.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Library</div><h1>My worksheets</h1><p class="sub">Every worksheet you publish is visible to all students immediately.</p></div>
      <button class="btn btn-primary" onclick="openBuilder()">+ New worksheet</button>
    </div>
    <div id="worksheetLibrary"><div class="empty">Loading...</div></div>
  `;

  let rows;
  try { rows = await api("/api/teacher/worksheets"); } catch { rows = []; }

  const wrap = el("worksheetLibrary");
  if (!rows.length) {
    wrap.innerHTML = `<div class="empty"><div class="empty-icon">▤</div><strong>No worksheets yet</strong><div class="help" style="margin-top:6px">Create your first worksheet from the builder.</div></div>`;
    return;
  }

  wrap.innerHTML = `<div class="grid grid-cards">${rows.map(w => `
    <article class="card card-flat">
      <div class="eyebrow">${escapeHtml(w.topic || "Worksheet")}</div>
      <h3 style="margin:7px 0 7px">${escapeHtml(w.title)}</h3>
      <p class="sub" style="font-size:13px">${w.questionCount} questions • ${w.submissionCount} submission${w.submissionCount === 1 ? "" : "s"} • ${new Date(w.createdAt).toLocaleDateString()}</p>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        ${w.submissionCount > 0
          ? `<button class="btn btn-secondary btn-sm" onclick="duplicateWorksheet('${w.id}')">Duplicate</button>
             <button class="btn btn-secondary btn-sm" onclick="openQueueForWorksheet('${w.id}')">Grading queue</button>`
          : `<button class="btn btn-secondary btn-sm" onclick="editWorksheet('${w.id}')">Edit</button>`
        }
        <button class="btn btn-danger btn-sm" onclick="archiveWorksheet('${w.id}')">Archive</button>
      </div>
    </article>
  `).join("")}</div>`;
}

window.openQueueForWorksheet = function (id) {
  queueFilter = { worksheetId: id, status: "" };
  switchView("queue");
};

// ---------- Grading Queue ----------

async function loadQueue() {
  const section = views.queue;
  const worksheets = await api("/api/teacher/worksheets").catch(() => []);

  section.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Review</div><h1>Grading queue</h1><p class="sub">Read each written answer and mark it by hand.</p></div>
      <div style="display:flex;gap:10px">
        <select id="queueWorksheetFilter" style="max-width:240px"><option value="">All worksheets</option>${worksheets.map(w => `<option value="${w.id}">${escapeHtml(w.title)}</option>`).join("")}</select>
        <select id="queueStatusFilter" style="max-width:180px">
          <option value="">All statuses</option>
          <option value="submitted">Pending</option>
          <option value="graded">Graded</option>
        </select>
      </div>
    </div>
    <div class="card"><div id="queueTable"><div class="empty">Loading...</div></div></div>
  `;

  el("queueWorksheetFilter").value = queueFilter.worksheetId;
  el("queueStatusFilter").value = queueFilter.status;
  el("queueWorksheetFilter").addEventListener("change", e => { queueFilter.worksheetId = e.target.value; renderQueueTable(); });
  el("queueStatusFilter").addEventListener("change", e => { queueFilter.status = e.target.value; renderQueueTable(); });

  await renderQueueTable();
}

async function renderQueueTable() {
  const params = new URLSearchParams();
  if (queueFilter.worksheetId) params.set("worksheetId", queueFilter.worksheetId);
  if (queueFilter.status) params.set("status", queueFilter.status);

  let rows;
  try { rows = await api(`/api/teacher/submissions?${params.toString()}`); } catch { rows = []; }

  const wrap = el("queueTable");
  if (!rows.length) {
    wrap.innerHTML = `<div class="empty"><div class="empty-icon">✓</div><strong>Nothing here</strong><div class="help" style="margin-top:6px">Student submissions will appear here once they submit homework.</div></div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Student</th><th>Worksheet</th><th>Status</th><th>Score</th><th>Time taken</th><th>Submitted</th><th></th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><strong>${escapeHtml(r.studentName)}</strong></td>
              <td>${escapeHtml(r.worksheetTitle)}</td>
              <td><span class="status-pill ${r.status === "graded" ? "status-graded" : "status-submitted"}"><span class="dot"></span>${r.status === "graded" ? "Graded" : "Pending"}</span></td>
              <td>${r.status === "graded" ? `<span class="score-pill ${r.percentage >= 75 ? "score-good" : r.percentage >= 60 ? "score-mid" : "score-low"}">${r.percentage}%</span>` : "—"}</td>
              <td>⏱ ${fmtDuration(r.timeSpentSeconds)}</td>
              <td>${new Date(r.submittedAt).toLocaleString()}</td>
              <td><button class="btn btn-primary btn-sm" onclick="openGrading('${r.id}')">${r.status === "graded" ? "Review" : "Grade"}</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ---------- Grading screen ----------

window.openGrading = async function (id) {
  switchViewSilent("detail");
  views.detail.innerHTML = `<div class="empty">Loading submission...</div>`;

  let submission;
  try { submission = await api(`/api/teacher/submissions/${id}`); }
  catch (err) { views.detail.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; return; }

  views.detail.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">${escapeHtml(submission.worksheetTitle)}</div>
        <h1 style="margin:5px 0 6px">${escapeHtml(submission.studentName)}</h1>
        <p class="sub">Submitted ${new Date(submission.submittedAt).toLocaleString()} · <span class="badge">⏱ Took ${fmtDuration(submission.timeSpentSeconds)}</span></p>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="switchView('queue')">← Back to queue</button>
    </div>

    <form id="gradeForm" class="grading-screen">
      <div>
        ${submission.review.map((q, i) => `
          <div class="answer-block" data-qid="${escapeHtml(q.questionId)}" data-marks="${q.marks}">
            <div style="font-weight:750">${i + 1}. ${escapeHtml(q.question)} <span class="help">(${q.marks} mark${q.marks === 1 ? "" : "s"})</span></div>
            ${q.guidance ? `<div class="guidance-box" style="margin-top:10px"><div class="guidance-label">🔒 Grading guidance</div>${escapeHtml(q.guidance)}</div>` : ""}
            ${renderAnswerContent(q)}
            <div class="correct-toggle" style="margin-top:12px">
              <button type="button" class="is-correct ${q.correct === true ? "active" : ""}" data-correct="true">✓ Correct</button>
              <button type="button" class="is-incorrect ${q.correct === false ? "active" : ""}" data-correct="false">✕ Incorrect</button>
            </div>
            <div class="marks-row">
              <label style="margin:0">Marks awarded</label>
              <input class="input marks-input" type="number" min="0" max="${q.marks}" value="${q.awardedMarks ?? 0}">
            </div>
            <div class="field" style="margin-top:10px;margin-bottom:0">
              <label>Feedback for this question (optional)</label>
              <textarea class="q-feedback" style="min-height:60px" placeholder="e.g. Good method, check your sign in step 2.">${escapeHtml(q.feedback || "")}</textarea>
            </div>
          </div>
        `).join("")}
      </div>

      <div class="card grade-side-card">
        <div class="card-head"><h2>Grade summary</h2></div>
        <div class="field">
          <label for="overallFeedback">Overall feedback (optional)</label>
          <textarea id="overallFeedback" placeholder="General comments for this submission...">${escapeHtml(submission.overallFeedback || "")}</textarea>
        </div>
        <button class="btn btn-primary" id="submitGradeBtn" type="submit" style="width:100%;justify-content:center">${submission.status === "graded" ? "Update grade" : "Submit grade"}</button>
      </div>
    </form>
  `;

  document.querySelectorAll(".correct-toggle button").forEach(btn => {
    btn.addEventListener("click", () => {
      const block = btn.closest(".answer-block");
      block.querySelectorAll(".correct-toggle button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const marksInput = block.querySelector(".marks-input");
      const maxMarks = Number(block.dataset.marks);
      marksInput.value = btn.dataset.correct === "true" ? maxMarks : 0;
    });
  });

  el("gradeForm").addEventListener("submit", e => submitGrade(e, id));
  typeset();
};

async function submitGrade(event, submissionId) {
  event.preventDefault();
  const blocks = [...document.querySelectorAll(".answer-block")];
  const missing = blocks.filter(b => !b.querySelector(".correct-toggle button.active"));
  if (missing.length) return toast(`Mark question ${blocks.indexOf(missing[0]) + 1} as correct or incorrect before submitting.`);

  const review = blocks.map(block => {
    const maxMarks = Number(block.dataset.marks);
    const awardedMarks = Math.max(0, Math.min(maxMarks, Number(block.querySelector(".marks-input").value) || 0));
    return {
      questionId: block.dataset.qid,
      correct: block.querySelector(".correct-toggle button.active").dataset.correct === "true",
      awardedMarks,
      feedback: block.querySelector(".q-feedback").value.trim()
    };
  });

  const btn = el("submitGradeBtn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    await api(`/api/teacher/submissions/${submissionId}/grade`, {
      method: "POST",
      body: JSON.stringify({ review, overallFeedback: el("overallFeedback").value.trim() })
    });
    toast("Grade submitted — the student can now see their score.");
    switchView("queue");
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Submit grade";
    toast(err.message);
  }
}

// ---------- Students ----------

async function loadStudents() {
  const section = views.students;
  section.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Roster</div><h1>Students</h1><p class="sub">Add a student account — they can log in with the username and password right away.</p></div>
    </div>
    <div class="grid grid-2">
      <section class="card">
        <div class="card-head"><h2>Add student</h2></div>
        <div class="field"><label for="studentName">Full name</label><input class="input" id="studentName" placeholder="e.g. Senuli Perera"></div>
        <div class="field"><label for="studentUsername">Username</label><input class="input" id="studentUsername" placeholder="e.g. senuli08"></div>
        <div class="field"><label for="studentPassword">Password</label><input class="input" id="studentPassword" type="password" placeholder="At least 6 characters"></div>
        <button class="btn btn-primary" id="addStudentBtn">Add student</button>
      </section>
      <section class="card">
        <div class="card-head"><h2>Existing students</h2><span class="badge" id="studentCountBadge">0</span></div>
        <div id="studentList"><div class="empty">Loading...</div></div>
      </section>
    </div>
  `;

  el("addStudentBtn").addEventListener("click", async () => {
    const name = el("studentName").value.trim();
    const username = el("studentUsername").value.trim();
    const password = el("studentPassword").value;
    if (!name || !username || password.length < 6) return toast("Enter a name, username and a password of at least 6 characters.");

    const btn = el("addStudentBtn");
    btn.disabled = true;
    btn.textContent = "Adding...";
    try {
      await api("/api/teacher/students", { method: "POST", body: JSON.stringify({ name, username, password }) });
      toast(`Student account created for ${name}.`);
      el("studentName").value = ""; el("studentUsername").value = ""; el("studentPassword").value = "";
      renderStudentList();
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Add student";
    }
  });

  await renderStudentList();
}

async function renderStudentList() {
  let students;
  try { students = await api("/api/teacher/students"); } catch { students = []; }

  el("studentCountBadge").textContent = students.length;
  const wrap = el("studentList");
  if (!students.length) {
    wrap.innerHTML = `<div class="empty"><div class="empty-icon">◈</div><strong>No students yet</strong><div class="help" style="margin-top:6px">Add one using the form.</div></div>`;
    return;
  }

  wrap.innerHTML = students.map(s => `
    <div class="question-row" style="grid-template-columns:1fr">
      <div>
        <div class="q-title">${escapeHtml(s.name)}</div>
        <div class="q-meta">Username: ${escapeHtml(s.username)}</div>
      </div>
    </div>
  `).join("");
}

// ---------- Init ----------

(async function init() {
  try {
    currentUser = await api("/api/auth/me");
  } catch {
    return location.href = "/";
  }
  if (currentUser.role !== "teacher") return location.href = "/student";

  el("whoBadge").textContent = currentUser.name;
  switchView("dashboard");
})();
