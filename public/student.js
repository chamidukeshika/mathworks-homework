const el = id => document.getElementById(id);
const views = {
  dashboard: el("dashboardView"),
  worksheets: el("worksheetsView"),
  grades: el("gradesView"),
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
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  let data = {};
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new Error(data.message || "Something went wrong.");
  return data;
}

function switchView(name) {
  pauseActiveTimer();
  Object.entries(views).forEach(([key, node]) => node.style.display = key === name ? "" : "none");
  document.querySelectorAll(".nav-item[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  if (name === "dashboard") loadDashboard();
  if (name === "worksheets") loadWorksheets();
  if (name === "grades") loadGrades();
}

document.querySelectorAll(".nav-item[data-view]").forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

el("logoutBtn").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  location.href = "/";
});

// ---------- Charts ----------

const PALETTE = {
  violet: "#4a3aa7", blue: "#2a78d6", orange: "#eb6834",
  success: "#0ca30c", danger: "#d03b3b", warning: "#f0a500",
  line: "#eceefa", grid: "#eceefa", neutral: "#c7cadb"
};

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

function chartCard({ id, title, sub, empty, emptyMessage, bodyHtml, icon = "📊", iconBg = "var(--primary-soft)", iconColor = "var(--primary-dark)" }) {
  return `
    <div class="chart-card">
      <div class="chart-card-head">
        <div class="chart-icon" style="background:${iconBg};color:${iconColor}">${icon}</div>
        <h3>${escapeHtml(title)}</h3>
      </div>
      <div class="chart-sub">${escapeHtml(sub)}</div>
      ${empty
        ? `<div class="chart-empty"><span style="font-size:22px">🌱</span>${escapeHtml(emptyMessage)}</div>`
        : (bodyHtml || `<div class="chart-wrap"><canvas id="${id}"></canvas></div>`)
      }
    </div>
  `;
}

function baseOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 }, usePointStyle: true, pointStyle: "circle" } } },
    ...extra
  };
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function computeStreak(activityByWeek) {
  if (!activityByWeek.length) return 0;
  const weeks = [...activityByWeek].sort((a, b) => a.week.localeCompare(b.week));
  let streak = 1;
  for (let i = weeks.length - 1; i > 0; i--) {
    const gapDays = (new Date(weeks[i].week) - new Date(weeks[i - 1].week)) / 86400000;
    if (gapDays === 7) streak += 1; else break;
  }
  return streak;
}

// ---------- Dashboard ----------

async function loadDashboard() {
  const section = views.dashboard;
  const firstName = currentUser ? escapeHtml(currentUser.name.split(" ")[0]) : "";
  section.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Overview</div>
        <h1>${greeting()}${firstName ? ", " + firstName : ""} 👋</h1>
        <p class="sub">Track your worksheet progress and where to focus next.</p>
      </div>
    </div>
    <div class="grid grid-auto" id="statTiles" style="margin-bottom:18px"></div>
    <div class="chart-grid" id="chartGrid"></div>
  `;

  let stats;
  try {
    stats = await api("/api/student/stats");
  } catch {
    section.querySelector("#chartGrid").innerHTML = `<div class="empty">Could not load your stats.</div>`;
    return;
  }

  const gradedScores = stats.scoreTrend.map(s => s.percentage);
  const avgScore = gradedScores.length ? Math.round(gradedScores.reduce((a, b) => a + b, 0) / gradedScores.length) : 0;
  const best = stats.scoreTrend.reduce((top, s) => (!top || s.percentage > top.percentage ? s : top), null);
  const streak = computeStreak(stats.activityByWeek);
  const totalEarned = stats.scoreTrend.reduce((sum, s) => sum + (s.earnedMarks || 0), 0);
  const totalPossible = stats.scoreTrend.reduce((sum, s) => sum + (s.totalMarks || 0), 0);

  el("statTiles").innerHTML = `
    <div class="stat"><div class="stat-icon" style="background:var(--success-soft);color:var(--success)">✓</div><div class="stat-body"><div class="stat-value">${stats.statusBreakdown.graded}</div><div class="stat-label">Worksheets graded</div></div></div>
    <div class="stat"><div class="stat-icon" style="background:var(--accent-violet-soft);color:var(--accent-violet)">★</div><div class="stat-body"><div class="stat-value">${avgScore}%</div><div class="stat-label">Average score</div></div></div>
    <div class="stat"><div class="stat-icon" style="background:var(--warning-soft);color:#96700a">⏳</div><div class="stat-body"><div class="stat-value">${stats.statusBreakdown.submitted}</div><div class="stat-label">Awaiting review</div></div></div>
    <div class="stat"><div class="stat-icon" style="background:var(--accent-orange-soft);color:var(--accent-orange)">🏆</div><div class="stat-body"><div class="stat-value">${best ? best.percentage + "%" : "—"}</div><div class="stat-label">${best ? "Best: " + escapeHtml(best.label.length > 18 ? best.label.slice(0, 18) + "…" : best.label) : "Best score"}</div></div></div>
    <div class="stat"><div class="stat-icon" style="background:var(--accent-blue-soft);color:var(--accent-blue)">🔥</div><div class="stat-body"><div class="stat-value">${streak}</div><div class="stat-label">Week streak</div></div></div>
    <div class="stat"><div class="stat-icon" style="background:var(--primary-soft);color:var(--primary-dark)">🎓</div><div class="stat-body"><div class="stat-value">${totalPossible ? `${totalEarned}/${totalPossible}` : "—"}</div><div class="stat-label">Total marks earned</div></div></div>
  `;

  const grid = el("chartGrid");
  grid.innerHTML =
    chartCard({ id: "scoreTrendChart", title: "Score trend", sub: "Your graded worksheets over time", empty: !stats.scoreTrend.length, emptyMessage: "No graded worksheets yet.", icon: "📈", iconBg: "var(--accent-violet-soft)", iconColor: "var(--accent-violet)" }) +
    chartCard({ id: "accuracyChart", title: "Accuracy trend", sub: "% of questions marked correct, per week", empty: !stats.accuracyByWeek.length, emptyMessage: "Get a worksheet graded to see this.", icon: "🧠", iconBg: "var(--accent-blue-soft)", iconColor: "var(--accent-blue)" }) +
    chartCard({ id: "statusChart", title: "Worksheet status", sub: "Not started vs submitted vs graded", empty: false, icon: "🗂️", iconBg: "var(--primary-soft)", iconColor: "var(--primary-dark)" }) +
    chartCard({ id: "topicChart", title: "Average by topic", sub: "Where you're strongest right now", empty: !stats.averageByTopic.length, emptyMessage: "No graded worksheets yet.", icon: "🎯", iconBg: "var(--accent-blue-soft)", iconColor: "var(--accent-blue)" }) +
    chartCard({ id: "activityChart", title: "Weekly activity", sub: "Submissions per week", empty: !stats.activityByWeek.length, emptyMessage: "Submit a worksheet to see activity.", icon: "📅", iconBg: "var(--accent-orange-soft)", iconColor: "var(--accent-orange)" }) +
    chartCard({ id: "correctChart", title: "Correct vs needs review", sub: "Across all graded questions", empty: (stats.correctRatio.correct + stats.correctRatio.needsReview) === 0, emptyMessage: "No graded questions yet.", icon: "✓", iconBg: "var(--success-soft)", iconColor: "var(--success)" });

  destroyChart("scoreTrend"); destroyChart("accuracy"); destroyChart("status"); destroyChart("topic"); destroyChart("activity"); destroyChart("correct");

  if (stats.scoreTrend.length) {
    charts.scoreTrend = new Chart(el("scoreTrendChart"), {
      type: "line",
      data: {
        labels: stats.scoreTrend.map(s => s.label.length > 14 ? s.label.slice(0, 14) + "…" : s.label),
        datasets: [{
          label: "Score %", data: gradedScores, borderColor: PALETTE.violet, borderWidth: 2.5,
          backgroundColor: "rgba(74,58,167,.10)", fill: true, tension: 0.35, pointRadius: 4,
          pointBackgroundColor: "#fff", pointBorderColor: PALETTE.violet, pointBorderWidth: 2, pointHoverRadius: 6
        }]
      },
      options: baseOptions({ plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, grid: { color: PALETTE.grid } }, x: { grid: { display: false } } } })
    });
  }

  if (stats.accuracyByWeek.length) {
    charts.accuracy = new Chart(el("accuracyChart"), {
      type: "line",
      data: {
        labels: stats.accuracyByWeek.map(w => fmtDate(w.week)),
        datasets: [{
          label: "Accuracy %", data: stats.accuracyByWeek.map(w => w.percentage), borderColor: PALETTE.blue, borderWidth: 2.5,
          backgroundColor: "rgba(42,120,214,.10)", fill: true, tension: 0.35, pointRadius: 4,
          pointBackgroundColor: "#fff", pointBorderColor: PALETTE.blue, pointBorderWidth: 2, pointHoverRadius: 6
        }]
      },
      options: baseOptions({ plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, grid: { color: PALETTE.grid } }, x: { grid: { display: false } } } })
    });
  }

  charts.status = new Chart(el("statusChart"), {
    type: "doughnut",
    data: {
      labels: ["Not started", "Awaiting review", "Graded"],
      datasets: [{ data: [stats.statusBreakdown.notStarted, stats.statusBreakdown.submitted, stats.statusBreakdown.graded], backgroundColor: [PALETTE.neutral, PALETTE.warning, PALETTE.success], borderWidth: 3, borderColor: "#fff" }]
    },
    options: baseOptions({ cutout: "66%" })
  });

  if (stats.averageByTopic.length) {
    charts.topic = new Chart(el("topicChart"), {
      type: "bar",
      data: { labels: stats.averageByTopic.map(t => t.topic), datasets: [{ label: "Average %", data: stats.averageByTopic.map(t => t.average), backgroundColor: PALETTE.blue, borderRadius: 8, maxBarThickness: 46 }] },
      options: baseOptions({ plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, grid: { color: PALETTE.grid } }, x: { grid: { display: false } } } })
    });
  }

  if (stats.activityByWeek.length) {
    charts.activity = new Chart(el("activityChart"), {
      type: "bar",
      data: { labels: stats.activityByWeek.map(w => fmtDate(w.week)), datasets: [{ label: "Submissions", data: stats.activityByWeek.map(w => w.count), backgroundColor: PALETTE.orange, borderRadius: 8, maxBarThickness: 46 }] },
      options: baseOptions({ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: PALETTE.grid } }, x: { grid: { display: false } } } })
    });
  }

  if (stats.correctRatio.correct + stats.correctRatio.needsReview > 0) {
    charts.correct = new Chart(el("correctChart"), {
      type: "doughnut",
      data: { labels: ["Correct", "Needs review"], datasets: [{ data: [stats.correctRatio.correct, stats.correctRatio.needsReview], backgroundColor: [PALETTE.success, PALETTE.danger], borderWidth: 3, borderColor: "#fff" }] },
      options: baseOptions({ cutout: "66%" })
    });
  }
}

// ---------- Worksheets ----------

function statusPill(status) {
  const map = {
    "not-started": ["status-not-started", "Not started"],
    "in-progress": ["status-in-progress", "In progress"],
    "submitted": ["status-submitted", "Awaiting review"],
    "graded": ["status-graded", "Graded"]
  };
  const [cls, label] = map[status] || map["not-started"];
  return `<span class="status-pill ${cls}"><span class="dot"></span>${label}</span>`;
}

// A worksheet has no server-side "in progress" state (it's only saved once
// submitted) — this checks the browser's own saved draft/timer to tell
// whether the student has already started answering it.
function hasInProgressWork(worksheetId) {
  try {
    const timer = JSON.parse(localStorage.getItem(`mw_timer_${worksheetId}`));
    if (timer && (timer.elapsedMs > 0 || timer.runningSince)) return true;
  } catch { /* ignore */ }
  try {
    const draft = JSON.parse(localStorage.getItem(`mw_draft_${worksheetId}`));
    if (draft && Object.values(draft).some(d => (d.text && d.text.trim()) || d.drawing)) return true;
  } catch { /* ignore */ }
  return false;
}

async function loadWorksheets() {
  const section = views.worksheets;
  section.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Homework</div><h1>Worksheets</h1><p class="sub">Answer with full working — your teacher grades each one by hand.</p></div>
    </div>
    <div id="worksheetList"><div class="empty">Loading worksheets...</div></div>
  `;

  let rows;
  try { rows = await api("/api/student/worksheets"); } catch { rows = []; }

  const wrap = el("worksheetList");
  if (!rows.length) {
    wrap.innerHTML = `<div class="empty"><div class="empty-icon">▤</div><strong>No worksheets yet</strong><div class="help" style="margin-top:6px">Your teacher hasn't published any homework yet.</div></div>`;
    return;
  }

  wrap.innerHTML = `<div class="grid grid-cards">${rows.map(w => {
    const inProgress = w.status === "not-started" && hasInProgressWork(w.id);
    return `
    <article class="card card-flat">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div class="eyebrow">${escapeHtml(w.topic || "Worksheet")}</div>
        ${statusPill(inProgress ? "in-progress" : w.status)}
      </div>
      <h3 style="margin:7px 0 7px">${escapeHtml(w.title)}</h3>
      <p class="sub" style="font-size:13px">${w.questionCount} question${w.questionCount === 1 ? "" : "s"}${w.percentage != null ? ` • ${w.percentage}%` : ""}</p>
      <div style="margin-top:12px">
        ${w.status === "not-started"
          ? `<button class="btn btn-primary btn-sm" onclick="openWorksheet('${w.id}')">${inProgress ? "Resume worksheet →" : "Start worksheet →"}</button>`
          : `<button class="btn btn-secondary btn-sm" onclick="openSubmission('${w.submissionId}')">${w.status === "graded" ? "View result" : "View status"}</button>`
        }
      </div>
    </article>
  `;
  }).join("")}</div>`;
}

// ---------- Drawing pad (type-or-draw answers, stylus-friendly) ----------

function initDrawPad(canvas) {
  const ctx = canvas.getContext("2d");
  let drawing = false;
  let color = "#171a2b";
  let width = 3;
  let erasing = false;
  let hasContent = false;
  const undoStack = [];

  function fillWhite() {
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  fillWhite();

  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
  }
  function pushUndo() {
    undoStack.push(canvas.toDataURL("image/png"));
    if (undoStack.length > 25) undoStack.shift();
  }
  function restoreFrom(dataUrl) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => { fillWhite(); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); resolve(); };
      img.src = dataUrl;
    });
  }

  canvas.addEventListener("pointerdown", e => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    pushUndo();
    drawing = true;
    hasContent = true;
    const p = pos(e);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  });
  canvas.addEventListener("pointermove", e => {
    if (!drawing) return;
    const p = pos(e);
    ctx.globalCompositeOperation = erasing ? "destination-out" : "source-over";
    ctx.strokeStyle = color;
    ctx.lineWidth = erasing ? width * 4 : width;
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach(evt => canvas.addEventListener(evt, () => { drawing = false; }));

  return {
    setColor: c => { color = c; },
    setWidth: w => { width = w; },
    setErasing: v => { erasing = v; },
    clear: () => { pushUndo(); fillWhite(); hasContent = false; },
    undo: async () => {
      const prev = undoStack.pop();
      if (prev) await restoreFrom(prev); else { fillWhite(); hasContent = false; }
    },
    isBlank: () => !hasContent,
    toDataURL: () => canvas.toDataURL("image/png"),
    loadFromDataURL: url => restoreFrom(url).then(() => { hasContent = true; })
  };
}

// ---------- Answering a worksheet ----------

function draftKey(worksheetId) { return `mw_draft_${worksheetId}`; }

// ---------- Time-on-task timer ----------
// Tracks active working time per worksheet, pausing whenever the student
// navigates away and resuming from where it left off when they come back.

let activeTimer = null; // { worksheetId, intervalId }

function timerKey(worksheetId) { return `mw_timer_${worksheetId}`; }

function loadTimerState(worksheetId) {
  try {
    const parsed = JSON.parse(localStorage.getItem(timerKey(worksheetId)));
    if (parsed && typeof parsed.elapsedMs === "number") return parsed;
  } catch { /* ignore corrupt state */ }
  return { elapsedMs: 0, runningSince: null };
}
function saveTimerState(worksheetId, state) {
  localStorage.setItem(timerKey(worksheetId), JSON.stringify(state));
}
function currentElapsedMs(state) {
  return state.elapsedMs + (state.runningSince ? Date.now() - state.runningSince : 0);
}
function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function pauseActiveTimer() {
  if (!activeTimer) return;
  const { worksheetId, intervalId } = activeTimer;
  clearInterval(intervalId);
  const state = loadTimerState(worksheetId);
  if (state.runningSince) {
    state.elapsedMs += Date.now() - state.runningSince;
    state.runningSince = null;
    saveTimerState(worksheetId, state);
  }
  activeTimer = null;
}

function updateTimerDisplay(worksheetId) {
  const badge = document.getElementById("worksheetTimer");
  if (!badge) return;
  badge.textContent = `⏱ ${formatDuration(currentElapsedMs(loadTimerState(worksheetId)))}`;
}

function startOrResumeTimer(worksheetId) {
  pauseActiveTimer();
  const state = loadTimerState(worksheetId);
  state.runningSince = Date.now();
  saveTimerState(worksheetId, state);
  updateTimerDisplay(worksheetId);
  const intervalId = setInterval(() => updateTimerDisplay(worksheetId), 1000);
  activeTimer = { worksheetId, intervalId };
}

// Folds any running time into the total, clears the stored timer, and
// returns the final elapsed seconds — used once, at submit time.
function finalizeTimer(worksheetId) {
  pauseActiveTimer();
  const seconds = Math.round(loadTimerState(worksheetId).elapsedMs / 1000);
  localStorage.removeItem(timerKey(worksheetId));
  return seconds;
}

window.addEventListener("beforeunload", pauseActiveTimer);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pauseActiveTimer();
    return;
  }
  // Tab became visible again — resume only if the answering screen for
  // that worksheet is still the one on screen (not navigated away).
  const badge = document.getElementById("worksheetTimer");
  if (badge && !activeTimer) startOrResumeTimer(badge.dataset.worksheetId);
});

function drawToolbarHtml() {
  return `
    <div class="draw-toolbar">
      <div class="swatches">
        <button type="button" class="color-swatch active" data-color="#171a2b" style="background:#171a2b" title="Black"></button>
        <button type="button" class="color-swatch" data-color="#2451c9" style="background:#2451c9" title="Blue"></button>
        <button type="button" class="color-swatch" data-color="#c92451" style="background:#c92451" title="Red"></button>
      </div>
      <div class="segmented width-toggle">
        <button type="button" class="width-btn" data-width="2">Thin</button>
        <button type="button" class="width-btn active" data-width="3">Medium</button>
        <button type="button" class="width-btn" data-width="7">Thick</button>
      </div>
      <button type="button" class="btn btn-ghost btn-sm eraser-btn">🧹 Eraser</button>
      <button type="button" class="btn btn-ghost btn-sm undo-btn">↺ Undo</button>
      <button type="button" class="btn btn-ghost btn-sm clear-btn">Clear</button>
    </div>
    <canvas class="answer-canvas" width="1000" height="560"></canvas>
  `;
}

window.openWorksheet = async function (id) {
  pauseActiveTimer();
  switchViewSilent("detail");
  views.detail.innerHTML = `<div class="empty">Loading worksheet...</div>`;

  let worksheet;
  try { worksheet = await api(`/api/student/worksheets/${id}`); }
  catch (err) { views.detail.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; return; }

  let draft = {};
  try { draft = JSON.parse(localStorage.getItem(draftKey(id)) || "{}"); } catch { draft = {}; }

  views.detail.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">${escapeHtml(worksheet.topic || "Homework")}</div>
        <h1 style="margin:5px 0 6px">${escapeHtml(worksheet.title)}</h1>
        <p class="sub">${escapeHtml(worksheet.description || `${worksheet.questions.length} questions`)}</p>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span class="badge" id="worksheetTimer" data-worksheet-id="${escapeHtml(id)}" title="Time spent actively working on this worksheet">⏱ 00:00</span>
        <button class="btn btn-secondary btn-sm" onclick="switchView('worksheets')">← Back to worksheets</button>
      </div>
    </div>

    <form id="worksheetForm">
      ${worksheet.questions.map((q, i) => `
        <section class="question-card" data-qid="${escapeHtml(q.id)}">
          <div class="question-top">
            <div class="student-qnum">${i + 1}</div>
            <div class="student-question">${escapeHtml(q.question)} <span class="help">(${q.marks} mark${q.marks === 1 ? "" : "s"})</span></div>
          </div>
          <div class="student-answer">
            <div class="segmented answer-mode-toggle">
              <button type="button" class="mode-btn active" data-mode="type">⌨ Type</button>
              <button type="button" class="mode-btn" data-mode="draw">✏ Draw (stylus friendly)</button>
            </div>
            <div class="answer-type-panel">
              <textarea class="answer-textarea" placeholder="Write your answer here, showing your steps...">${escapeHtml(draft[q.id]?.text || "")}</textarea>
            </div>
            <div class="answer-draw-panel" style="display:none">
              ${drawToolbarHtml()}
            </div>
          </div>
        </section>
      `).join("")}

      <div class="submit-bar">
        <div><strong>Ready to submit?</strong><div class="help">Once submitted, your teacher will review and grade your work.</div></div>
        <button class="btn btn-primary" id="submitBtn" type="submit">Submit worksheet →</button>
      </div>
    </form>
  `;

  const drawPads = {};
  const questionModes = {};
  let saveTimer = null;
  function scheduleDraftSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      localStorage.setItem(draftKey(id), JSON.stringify(getDraftState(worksheet, drawPads, questionModes)));
    }, 400);
  }

  worksheet.questions.forEach(q => {
    const card = views.detail.querySelector(`.question-card[data-qid="${CSS.escape(q.id)}"]`);
    const canvas = card.querySelector(".answer-canvas");
    const pad = initDrawPad(canvas);
    drawPads[q.id] = pad;
    if (draft[q.id]?.drawing) pad.loadFromDataURL(draft[q.id].drawing);

    const typePanel = card.querySelector(".answer-type-panel");
    const drawPanel = card.querySelector(".answer-draw-panel");
    function applyMode(mode) {
      questionModes[q.id] = mode;
      card.querySelectorAll(".mode-btn").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
      typePanel.style.display = mode === "type" ? "" : "none";
      drawPanel.style.display = mode === "draw" ? "" : "none";
    }
    applyMode(draft[q.id]?.mode || "type");
    card.querySelectorAll(".mode-btn").forEach(b => b.addEventListener("click", () => { applyMode(b.dataset.mode); scheduleDraftSave(); }));

    card.querySelectorAll(".color-swatch").forEach(b => b.addEventListener("click", () => {
      card.querySelectorAll(".color-swatch").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      pad.setColor(b.dataset.color);
      pad.setErasing(false);
      card.querySelector(".eraser-btn").classList.remove("active");
    }));
    card.querySelectorAll(".width-btn").forEach(b => b.addEventListener("click", () => {
      card.querySelectorAll(".width-btn").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      pad.setWidth(Number(b.dataset.width));
    }));
    card.querySelector(".eraser-btn").addEventListener("click", e => {
      const active = !e.currentTarget.classList.contains("active");
      e.currentTarget.classList.toggle("active", active);
      pad.setErasing(active);
    });
    card.querySelector(".undo-btn").addEventListener("click", () => pad.undo());
    card.querySelector(".clear-btn").addEventListener("click", () => pad.clear());
    canvas.addEventListener("pointerup", scheduleDraftSave);
  });

  const form = el("worksheetForm");
  form.addEventListener("input", scheduleDraftSave);
  form.addEventListener("submit", e => submitWorksheet(e, worksheet, drawPads));
  startOrResumeTimer(id);
  typeset();
};

// Captures BOTH the typed text and the drawing for a question, regardless of
// which mode is currently visible — a student can answer with keyboard and
// stylus at once, and both are kept rather than one silently overwriting the other.
function captureAnswer(card, pad) {
  return {
    text: card.querySelector(".answer-textarea")?.value || "",
    drawing: pad && !pad.isBlank() ? pad.toDataURL() : null
  };
}

function getAnswers(worksheet, drawPads) {
  const answers = {};
  worksheet.questions.forEach(q => {
    const card = views.detail.querySelector(`.question-card[data-qid="${CSS.escape(q.id)}"]`);
    answers[q.id] = captureAnswer(card, drawPads[q.id]);
  });
  return answers;
}

function getDraftState(worksheet, drawPads, questionModes) {
  const state = {};
  worksheet.questions.forEach(q => {
    const card = views.detail.querySelector(`.question-card[data-qid="${CSS.escape(q.id)}"]`);
    state[q.id] = { mode: questionModes[q.id] || "type", ...captureAnswer(card, drawPads[q.id]) };
  });
  return state;
}

async function submitWorksheet(event, worksheet, drawPads) {
  event.preventDefault();
  const answers = getAnswers(worksheet, drawPads);
  const unanswered = Object.values(answers).filter(a => !a.text.trim() && !a.drawing).length;
  if (unanswered && !confirm(`You still have ${unanswered} unanswered question${unanswered === 1 ? "" : "s"}. Submit anyway?`)) return;

  const timeSpentSeconds = finalizeTimer(worksheet.id);
  const btn = el("submitBtn");
  btn.disabled = true;
  btn.textContent = "Submitting...";

  try {
    await api(`/api/student/worksheets/${worksheet.id}/submit`, {
      method: "POST",
      body: JSON.stringify({ answers, timeSpentSeconds })
    });
    localStorage.removeItem(draftKey(worksheet.id));
    renderAwaitingReview(worksheet);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Submit worksheet →";
    toast(err.message);
  }
}

function renderAwaitingReview(worksheet) {
  views.detail.innerHTML = `
    <section class="card result-card">
      <div class="eyebrow">Submitted successfully</div>
      <h1 style="margin:7px 0 4px">${escapeHtml(worksheet.title)}</h1>
      <p class="sub">Your teacher hasn't reviewed this yet — check back soon.</p>
      <div style="margin-top:18px"><button class="btn btn-secondary" onclick="switchView('worksheets')">Back to worksheets</button></div>
    </section>
  `;
}

// ---------- Grades ----------

async function loadGrades() {
  const section = views.grades;
  section.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Review</div><h1>My grades</h1><p class="sub">See your teacher's feedback on every submitted worksheet.</p></div></div>
    <div class="card"><div id="gradesTable"><div class="empty">Loading...</div></div></div>
  `;

  let rows;
  try { rows = await api("/api/student/submissions"); } catch { rows = []; }

  const wrap = el("gradesTable");
  if (!rows.length) {
    wrap.innerHTML = `<div class="empty"><div class="empty-icon">✓</div><strong>No submissions yet</strong><div class="help" style="margin-top:6px">Answer a worksheet to see it appear here.</div></div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Worksheet</th><th>Status</th><th>Score</th><th>Submitted</th><th></th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><strong>${escapeHtml(r.worksheetTitle)}</strong>${r.worksheetTopic ? `<div class="help">${escapeHtml(r.worksheetTopic)}</div>` : ""}</td>
              <td>${statusPill(r.status)}</td>
              <td>${r.status === "graded" ? `<span class="score-pill ${r.percentage >= 75 ? "score-good" : r.percentage >= 60 ? "score-mid" : "score-low"}">${r.percentage}%</span>` : "—"}</td>
              <td>${new Date(r.submittedAt).toLocaleDateString()}</td>
              <td><button class="btn btn-secondary btn-sm" onclick="openSubmission('${r.id}')">View</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

window.openSubmission = async function (id) {
  pauseActiveTimer();
  switchViewSilent("detail");
  views.detail.innerHTML = `<div class="empty">Loading...</div>`;

  let submission;
  try { submission = await api(`/api/student/submissions/${id}`); }
  catch (err) { views.detail.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; return; }

  if (submission.status === "submitted") {
    views.detail.innerHTML = `
      <section class="card result-card">
        <div style="font-size:40px;margin-bottom:6px">⏳</div>
        <div class="eyebrow">Awaiting review</div>
        <h1 style="margin:7px 0 4px">${escapeHtml(submission.worksheetTitle)}</h1>
        <p class="sub">Submitted ${new Date(submission.submittedAt).toLocaleString()}. Your teacher hasn't graded this yet — check back soon.</p>
        <div style="margin-top:18px"><button class="btn btn-secondary" onclick="switchView('worksheets')">Back to worksheets</button></div>
      </section>
    `;
    return;
  }

  const celebrate = submission.percentage >= 90
    ? `<div class="celebrate">🎉 Excellent work!</div>`
    : submission.percentage >= 75
      ? `<div class="celebrate">👏 Nice job!</div>`
      : "";

  views.detail.innerHTML = `
    <section class="card result-card">
      <div class="eyebrow">Graded</div>
      <h1 style="margin:7px 0 4px">${escapeHtml(submission.worksheetTitle)}</h1>
      <div class="result-ring" style="--score:${submission.percentage}%"><strong>${submission.percentage}%</strong></div>
      <h2 style="margin-bottom:5px">${submission.earnedMarks} / ${submission.totalMarks} marks</h2>
      ${celebrate}
      ${submission.overallFeedback ? `<p class="sub" style="margin-top:10px">${escapeHtml(submission.overallFeedback)}</p>` : ""}
    </section>

    <section class="card" style="margin-top:16px">
      <div class="card-head"><h2>Question review</h2><span class="badge">${submission.review.length} questions</span></div>
      ${submission.review.map((q, i) => `
        <div class="review-item ${q.correct ? "good" : "bad"}">
          <div class="review-status">${q.correct ? "✓ Correct" : "✕ Needs review"} · ${q.awardedMarks}/${q.marks} marks</div>
          <div style="font-weight:750">${i + 1}. ${escapeHtml(q.question)}</div>
          ${renderAnswerContent(q)}
          ${q.feedback ? `<div class="help" style="margin-top:8px"><strong>Teacher feedback:</strong> ${escapeHtml(q.feedback)}</div>` : ""}
        </div>
      `).join("")}
      <div style="margin-top:18px;text-align:center"><button class="btn btn-secondary" onclick="switchView('worksheets')">Back to worksheets</button></div>
    </section>
  `;
  typeset();
};

function switchViewSilent(name) {
  Object.entries(views).forEach(([key, node]) => node.style.display = key === name ? "" : "none");
}

// ---------- Init ----------

(async function init() {
  try {
    currentUser = await api("/api/auth/me");
  } catch {
    return location.href = "/";
  }
  if (currentUser.role !== "student") return location.href = "/teacher";

  el("whoBadge").textContent = currentUser.name;
  switchView("dashboard");
})();
