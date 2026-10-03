"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = { cfg: {}, jdMeta: {}, resume: null, analysis: null, selected: new Set(), edits: {},
  filter: "all", kwFilter: null, pop: null, exported: false, prevText: {}, cover: null, coverEdited: false, tone: "warm",
  gaps: {}, gapExtra: new Set(), gapsSummary: "", outDir: "" };
const MIN_JD = 100;

async function api(path, body, isForm) {
  const opts = { method: body ? "POST" : "GET" };
  if (body) {
    if (isForm) opts.body = body;
    else { opts.headers = { "Content-Type": "application/json" }; opts.body = JSON.stringify(body); }
  }
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || `Request failed (${r.status})`);
  return data;
}

function status(el, msg, kind = "info", busy = false) {
  el.className = el.className.replace(/\b(info|ok|err)\b/g, "").trim() + " " + kind;
  if (!el.classList.contains("status")) el.classList.add("status");
  el.innerHTML = (busy ? '<span class="spinner"></span>' : "") + esc(msg);
}

function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = "toast " + kind; t.textContent = msg;
  $("toasts").appendChild(t);
  setTimeout(() => { t.classList.add("bye"); setTimeout(() => t.remove(), 300); }, kind === "err" || kind === "info" ? 7000 : 3000);
}

// ------------------------------------------------------------------ steps
function updateSteps() {
  const inReview = !$("reviewView").hidden, inCover = !$("coverView").hidden, past = inReview || inCover;
  const jdOk = $("jdText").value.trim().length > MIN_JD, resOk = !!state.resume;
  const st = {
    resume: resOk || past ? "done" : "current",
    jd: jdOk || past ? "done" : resOk ? "current" : "",
    review: inReview ? (state.exported ? "done" : "current") : inCover ? "done" : "",
    cover: inCover ? (state.cover ? "done" : "current") : state.cover ? "done" : "",
    export: state.exported ? "done" : "",
  };
  if (inCover && state.cover) st.export = state.exported ? "done" : "current";
  if (!past && jdOk && !resOk) st.resume = "current";
  if (!past && !jdOk && resOk) st.jd = "current";
  const lis = [...document.querySelectorAll("#stepper li")];
  lis.forEach((li) => { li.className = st[li.dataset.step] || ""; li.setAttribute("aria-current", st[li.dataset.step] === "current" ? "step" : "false"); });
  const cur = lis.findIndex((li) => li.className === "current"), at = cur >= 0 ? cur : lis.length - 1;
  $("stepCompact").textContent = `${lis[at].querySelector(".lbl").textContent} · ${at + 1} of ${lis.length}`;
  $("jdCard").classList.toggle("complete", jdOk);
  $("resumeCard").classList.toggle("complete", resOk);
}

// ------------------------------------------------------------------ setup
async function init() {
  state.cfg = await api("/api/config");
  state.outDir = state.cfg.output_dir || "";
  applyDocPrefs();
  const home = state.cfg.home || "~";
  $("resumePath").placeholder = state.cfg.os === "nt" ? `${home}\\Documents\\Resume.docx` : `~/Documents/Resume.docx`;
  if (state.cfg.last_resume_path) $("resumePath").value = state.cfg.last_resume_path;
  const ready = state.cfg.active_engine === "claude_code" ? !!state.cfg.claude_code_path : state.cfg.has_api_key;
  if (!ready) setTimeout(openSettings, 300);
  refreshAnalyze();
  const q = new URLSearchParams(location.search);
  if (q.get("job")) await openFromFinder(q);
}

function refreshAnalyze() {
  const n = $("jdText").value.trim().length, jdOk = n > MIN_JD && !fetchJob;
  $("analyzeBtn").disabled = !(state.resume && jdOk) || analyzing;
  $("findJobsBtn").disabled = !state.resume || !!findJob;
  const need = [];
  if (!state.resume) need.push("your resume");
  if (!jdOk) need.push(state.resume ? "a job (pick one above or add your own)" : "a job");
  $("analyzeNeed").textContent = analyzing ? "" : need.length ? `Add ${need.join(" and ")} to continue.` : "Ready when you are.";
  const c = $("jdCounter");
  c.textContent = n ? `${n.toLocaleString()} characters` : "";
  c.classList.toggle("low", n > 0 && !jdOk);
  if (n > 0 && !jdOk) c.textContent += " · a bit short";
  updateSteps();
}

// The posting is fetched as soon as a link is in the box: on paste, ~600ms after typing stops, on
// leaving the field or on Enter. The same URL is never fetched twice (Retry forces it); a new URL
// cancels the fetch in flight.
let fetchJob = null, fetchedUrl = "", fetchSeq = 0, fetchTimer = 0;
const looksLikeUrl = (u) => /^https?:\/\/[^\s/]+\.[^\s/]{2,}(\/\S*)?$/i.test(u);
async function fetchJd(force = false) {
  clearTimeout(fetchTimer);
  const url = $("jdUrl").value.trim();
  if (!url || !looksLikeUrl(url)) {
    if (force) status($("jdStatus"), url ? "That doesn't look like a web link (it should start with https://)." : "Paste a job link first.", "err");
    return;
  }
  if (!force && url === fetchedUrl) return;
  if (fetchJob) cancelJob(fetchJob);
  const seq = ++fetchSeq;
  fetchedUrl = url; fetchJob = { status: "starting" };
  $("fetchBtn").disabled = true; $("fetchBtn").textContent = "Fetch";
  status($("jdStatus"), "Fetching posting…", "info", true);
  refreshAnalyze();
  try {
    const d = await runJob("/api/jobs/jd_fetch", { url }, (job) => {
      if (seq !== fetchSeq) return cancelJob(job);  // a newer link replaced this one
      fetchJob = job;
      const { current } = jobProgress(job);
      if (job.status === "running") status($("jdStatus"), `Fetching posting… ${current ? current.message : ""}`, "info", true);
    });
    if (seq !== fetchSeq) return;
    state.jdMeta = d;
    $("jdText").value = d.text;
    $("jdTitle").textContent = [d.title, d.company].filter(Boolean).join(" — ") || "Job description";
    $("jdMethod").textContent = d.method;
    $("jdBox").hidden = false;
    status($("jdStatus"), `Got it — ${d.text.length.toLocaleString()} characters.`, "ok");
  } catch (e) {
    if (seq !== fetchSeq || e.cancelled) return;
    status($("jdStatus"), e.message, "err");
    $("fetchBtn").textContent = "Retry";
    $("jdBox").hidden = false;
    $("jdTitle").textContent = "Paste the job description";
    $("jdMethod").textContent = "manual";
  } finally {
    if (seq === fetchSeq) { fetchJob = null; $("fetchBtn").disabled = false; refreshAnalyze(); }
  }
}
$("fetchBtn").onclick = () => fetchJd(true);
$("jdUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); fetchJd($("fetchBtn").textContent === "Retry"); } });
$("jdUrl").addEventListener("paste", () => setTimeout(() => fetchJd(), 0));
$("jdUrl").addEventListener("input", () => { clearTimeout(fetchTimer); fetchTimer = setTimeout(() => fetchJd(), 600); });
$("jdUrl").addEventListener("blur", () => fetchJd());
$("pasteLink").onclick = (e) => {
  e.preventDefault();
  $("jdBox").hidden = false; $("jdTitle").textContent = "Paste the job description"; $("jdMethod").textContent = "manual";
  $("jdText").focus();
};
$("jdText").addEventListener("input", refreshAnalyze);

function onResumeLoaded(d) {
  state.resume = d;
  $("resumePath").value = d.path.includes(".resume-optimizer") ? $("resumePath").value : d.path;
  const fmt = d.keeps_formatting ? "Your formatting is kept when you download." : "PDF/TXT layout can't be kept, so you'll get a clean new .docx.";
  status($("resumeStatus"), `${d.count} paragraphs found. ${fmt}`, "ok");
  const dz = $("dropzone");
  dz.classList.add("loaded");
  dz.querySelector(".dz-icon").textContent = "✓";
  dz.querySelector(".dz-title").textContent = d.file_name;
  dz.querySelector(".dz-sub").textContent = "Drop another file to replace it";
  logLocal("Load resume", [
    { step: "read", label: "Read your resume", message: `Read ${d.file_name}` },
    { step: "parse", label: "Find paragraphs & sections", message: `Found ${d.count} paragraphs in ${d.sections} section${d.sections === 1 ? "" : "s"}`,
      detail: [...new Set(d.paragraphs.filter((x) => x.kind === "heading").map((x) => x.text.trim()))] },
  ]);
  refreshAnalyze();
  autoFind();
}
function onResumeFailed(msg) {
  state.resume = null;
  logLocal("Load resume", [{ step: "read", label: "Read your resume", message: msg, status: "error" }], "error", msg);
  status($("resumeStatus"), msg, "err");
  const dz = $("dropzone");
  dz.classList.remove("loaded");
  dz.querySelector(".dz-icon").textContent = "↑";
  dz.querySelector(".dz-title").textContent = "Drop your resume here";
  dz.querySelector(".dz-sub").textContent = "or click to choose · .docx, .pdf, .txt";
  refreshAnalyze();
}
$("loadBtn").onclick = async () => {
  status($("resumeStatus"), "Reading resume…", "info", true);
  try { onResumeLoaded(await api("/api/resume/load", { path: $("resumePath").value })); }
  catch (e) { onResumeFailed(e.message); }
};
$("resumePath").addEventListener("keydown", (e) => { if (e.key === "Enter") $("loadBtn").click(); });
$("browseBtn").onclick = async () => {
  status($("resumeStatus"), "A file picker opened on your computer (it may be behind this window)…", "info", true);
  try {
    const { path } = await api("/api/pick", { kind: "file" });
    if (!path) return status($("resumeStatus"), "No file chosen.", "info");
    $("resumePath").value = path; $("loadBtn").click();
  } catch (e) { status($("resumeStatus"), e.message, "err"); }
};
async function uploadFile(f) {
  if (!/\.(docx|pdf|txt|md)$/i.test(f.name)) return onResumeFailed(`${f.name} isn't supported — use .docx, .pdf or .txt.`);
  const fd = new FormData(); fd.append("file", f);
  status($("resumeStatus"), `Uploading ${f.name}…`, "info", true);
  try { onResumeLoaded(await api("/api/resume/upload", fd, true)); }
  catch (err) { onResumeFailed(err.message); }
}
$("uploadInput").onchange = (e) => { const f = e.target.files[0]; if (f) uploadFile(f); e.target.value = ""; };
const dz = $("dropzone");
["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
dz.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) uploadFile(f); });
// dropping anywhere else on the page shouldn't navigate away
["dragover", "drop"].forEach((ev) => window.addEventListener(ev, (e) => e.preventDefault()));

// ------------------------------------------------------------------ find fresh jobs
// Claude searches the web for postings that fit the loaded resume and are under 2 hours old. The search starts
// by itself once a resume is loaded (not in tabs opened from the list); "Search again" re-runs it. Each job opens
// in a new tab (/?job=…&from=<session>) that clones the resume into its own server session, fetches the posting
// and starts the usual analysis, so every job keeps its own edits, cover letter and file names.
let findJob = null, foundAt = 0, searchedFor = "";
const resumeKey = () => state.resume ? state.resume.paragraphs.map((x) => x.text).join("\n") : "";
// Runs once per distinct resume: reloading the same file doesn't search again, and a resume swapped in
// mid-search is searched for when the current search ends.
function autoFind() {
  if ($("findCard").hidden || !state.resume || findJob || resumeKey() === searchedFor) return;
  $("findJobsBtn").click();
}
const BASE_TITLE = document.title;
function setTabTitle(label) { document.title = label ? `${label} · ${BASE_TITLE}` : BASE_TITLE; }
const ago = (min) => min < 1 ? "just now" : min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""} ago`;

$("findJobsBtn").onclick = async () => {
  findJob = { status: "starting" }; searchedFor = resumeKey(); refreshAnalyze();
  $("findJobsBtn").hidden = true; $("findCancel").hidden = false; $("findResults").hidden = true;
  status($("findStatus"), "Claude is searching job boards. This can take a few minutes.", "info", true);
  try {
    const d = await runJob("/api/jobs/find_jobs", { session_id: state.resume.session_id }, (job) => {
      findJob = job;
      const { current } = jobProgress(job);
      if (job.status === "running" && current) status($("findStatus"), current.message + "…", "info", true);
    });
    foundAt = Date.now();
    renderJobs(d);
  } catch (e) {
    status($("findStatus"), e.cancelled ? "Search cancelled." : e.message, e.cancelled ? "info" : "err");
  } finally {
    findJob = null; $("findCancel").hidden = true; $("findJobsBtn").hidden = false;
    refreshAnalyze();
    autoFind();
  }
};
$("findCancel").onclick = () => cancelJob(findJob);

function renderJobs(d) {
  state.foundJobs = d.jobs;
  const n = d.jobs.length, left = d.dropped.length ? ` ${d.dropped.length} older or unverifiable posting${d.dropped.length === 1 ? " was" : "s were"} left out.` : "";
  if (!n) {
    $("findResults").hidden = true;
    return status($("findStatus"), `No postings from the last 2 hours matched your resume.${left} Try again a little later.`, "info");
  }
  status($("findStatus"), `Found ${n} job${n === 1 ? "" : "s"} posted in the last 2 hours${n < 5 ? " (fewer than 5 qualified)" : ""}.${left}`, "ok");
  const since = Math.round((Date.now() - foundAt) / 60000);
  $("jobList").innerHTML = d.jobs.map((j, i) => `<li class="job" data-i="${i}">
      <div>
        <div class="job-title"><a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a></div>
        <div class="job-meta">${[j.company, j.location, `posted ${ago(j.age_minutes + since)}`, j.source].filter(Boolean).map(esc).join(" · ")}</div>
      </div>
      <button class="primary sm" data-open="${i}">Tailor resume + cover letter</button>
      ${j.match_reason ? `<div class="job-why">${esc(j.match_reason)}</div>` : ""}
    </li>`).join("");
  $("tailorAll").textContent = `Tailor all ${n} in new tabs`;
  $("findResults").hidden = false;
}
function openJob(i) {
  const j = state.foundJobs[i];
  const q = new URLSearchParams({ job: j.url, from: state.resume.session_id, title: j.title, company: j.company });
  const w = window.open(`${location.pathname}?${q}`, "_blank");
  if (!w) return false;
  w.opener = null;
  document.querySelector(`.job[data-i="${i}"]`).classList.add("opened");
  document.querySelector(`[data-open="${i}"]`).textContent = "Opened in a new tab ↗";
  return true;
}
$("jobList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-open]");
  if (b && !openJob(+b.dataset.open)) toast("Your browser blocked the new tab. Allow pop-ups for this page and try again.", "err");
});
$("tailorAll").onclick = () => {
  const blocked = state.foundJobs.filter((_, i) => !openJob(i)).length;
  if (blocked) toast(`${blocked} tab${blocked === 1 ? " was" : "s were"} blocked. Allow pop-ups for this page, or open them one at a time.`, "err");
};

// A tab opened from the list: same resume (fresh session), this job's posting, then straight into Analyze.
async function openFromFinder(q) {
  setTabTitle([q.get("company"), q.get("title")].filter(Boolean).join(" – "));
  history.replaceState(null, "", location.pathname);  // a reload starts clean instead of re-running
  $("findCard").hidden = true;
  $("jdStepNo").textContent = "2"; $("jdHint").hidden = true;
  $("jdUrl").value = q.get("job");
  const resume = (async () => {
    if (!q.get("from")) return;
    status($("resumeStatus"), "Loading your resume…", "info", true);
    try { onResumeLoaded(await api("/api/resume/clone", { session_id: q.get("from") })); }
    catch (e) { onResumeFailed(`${e.message} Then click Analyze.`); }
  })();
  await Promise.all([fetchJd(true), resume]);
  if (!$("analyzeBtn").disabled) $("analyzeBtn").click();
  else if (state.resume) status($("analyzeStatus"), "Couldn't read this posting automatically. Paste the job description above, then click Analyze.", "info");
}

// ------------------------------------------------------------------ background jobs + activity
// Long operations run as server jobs. Their progress events arrive over Server-Sent Events
// (falling back to polling) and show in the Activity pill, its panel, and inline progress UIs.
const act = { jobs: [], openDetails: new Set() };
const STATUS_LBL = { running: "Running", done: "Done", error: "Failed", cancelled: "Cancelled" };
const STEP_ICON = { pending: "", running: '<span class="spinner"></span>', done: "✓", error: "✕" };
const now = () => Date.now() / 1000;
function fmtDur(sec) {
  sec = Math.max(0, sec);
  return sec < 60 ? `${sec.toFixed(sec < 10 ? 1 : 0)}s` : `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

function jobProgress(job) {
  const steps = job.plan.map((p) => ({ step: p.step, label: p.label, status: "pending", log: [] }));
  const by = Object.fromEntries(steps.map((x) => [x.step, x]));
  for (const ev of job.events) {
    let st = by[ev.step];
    if (!st) { st = by[ev.step] = { step: ev.step, label: ev.step, status: "pending", log: [] }; steps.push(st); }
    if (st.t0 == null) st.t0 = ev.ts;
    st.status = ev.status; st.message = ev.message; st.log.push(ev.message);
    if (ev.detail != null) st.detail = ev.detail;
    st.t1 = ev.status === "running" ? null : ev.ts;
  }
  const n = steps.length || 1, done = steps.filter((x) => x.status === "done").length;
  const ri = steps.findIndex((x) => x.status === "running");
  return { steps, n, done, cur: ri >= 0 ? ri : Math.min(done, n - 1), current: ri >= 0 ? steps[ri] : null };
}

async function runJob(path, body, onEvent) {
  const info = await api(path, body);  // bad input fails right here, before a job exists
  const job = { ...info, events: [], status: "running", t0: now(), seen: -1 };
  act.jobs.unshift(job); act.jobs.length = Math.min(act.jobs.length, 30);
  const changed = () => { if (onEvent) onEvent(job); renderActivity(); };
  changed();
  return new Promise((resolve, reject) => {
    let ended = false, fails = 0;
    const push = (ev) => {
      if (ev.seq <= job.seen) return;  // replayed after a reconnect
      job.seen = ev.seq; job.events.push(ev);
      if (ev.status === "running") $("actLive").textContent = ev.message;
      changed();
    };
    const finish = (end) => {
      if (ended) return; ended = true;
      job.status = end.status; job.error = end.error || ""; job.t1 = now();
      changed();
      if (end.status === "done") return resolve(end.result);
      const err = new Error(end.error || "Something went wrong."); err.cancelled = end.status === "cancelled";
      reject(err);
    };
    const poll = async () => {
      if (ended) return;
      try {
        const snap = await api(`/api/jobs/${job.job_id}?since=${job.seen + 1}`);
        fails = 0;
        snap.events.forEach(push);
        if (snap.status !== "running") return finish(snap);
      } catch (e) { if (++fails >= 4) return finish({ status: "error", error: e.message }); }
      setTimeout(poll, 700);
    };
    if (!window.EventSource) return poll();
    const es = new EventSource(`/api/jobs/${job.job_id}/events`);
    es.onmessage = (m) => push(JSON.parse(m.data));
    es.addEventListener("end", (m) => { es.close(); finish(JSON.parse(m.data)); });
    es.onerror = () => { es.close(); poll(); };  // stream dropped: carry on by polling
  });
}
function cancelJob(job) {
  if (job && job.status === "running") api(`/api/jobs/${job.job_id}/cancel`, {}).catch(() => {});
}
function logLocal(title, steps, status = "done", error = "") {
  const t = now();
  act.jobs.unshift({ job_id: "local-" + Math.random().toString(36).slice(2), title, local: true, status, error, t0: t, t1: t,
    plan: steps.map((x) => ({ step: x.step, label: x.label })),
    events: steps.map((x, i) => ({ seq: i, step: x.step, status: x.status || status, message: x.message, detail: x.detail, ts: t })) });
  renderActivity();
}

function stepHtml(job, st) {
  const key = `${job.job_id}:${st.step}`;
  const more = [...st.log.slice(0, -1), ...[].concat(st.detail ?? [])];
  const moreHtml = more.length ? `<details data-key="${esc(key)}"${act.openDetails.has(key) ? " open" : ""}>
      <summary>Details (${more.length})</summary><ul>${more.map((x) => `<li>${esc(typeof x === "string" ? x : JSON.stringify(x))}</li>`).join("")}</ul></details>` : "";
  return `<li class="st ${st.status}"><span class="st-ico" aria-hidden="true">${STEP_ICON[st.status] || ""}</span>
    <div class="st-body"><div class="st-label">${esc(st.label)}<span class="sr-only"> — ${esc(st.status)}</span></div>
      ${st.message ? `<div class="st-msg">${esc(st.message)}</div>` : ""}${moreHtml}</div>
    ${st.t0 != null ? `<span class="st-time" data-t0="${st.t0}"${st.t1 ? ` data-t1="${st.t1}"` : ""}></span>` : ""}</li>`;
}
function jobHtml(job) {
  const { steps } = jobProgress(job);
  return `<section class="act-job ${job.status}">
    <header class="act-job-head"><span class="act-badge ${job.status}">${STATUS_LBL[job.status]}</span><strong>${esc(job.title)}</strong>
      <span class="act-time" data-t0="${job.t0}"${job.t1 ? ` data-t1="${job.t1}"` : ""}></span>
      ${job.status === "running" && !job.local ? `<button class="ghost sm act-cancel" data-cancel="${esc(job.job_id)}">Cancel</button>` : ""}</header>
    <ol class="act-steps">${steps.map((x) => stepHtml(job, x)).join("")}</ol>
    ${job.error && job.status === "error" ? `<div class="act-err">${esc(job.error)}</div>` : ""}
  </section>`;
}
function renderActivity() {
  $("actList").innerHTML = act.jobs.length ? act.jobs.map(jobHtml).join("")
    : '<div class="muted small act-empty">Nothing yet. Fetching a job, analyzing, writing the cover letter and downloading all show up here, step by step.</div>';
  const run = act.jobs.find((j) => j.status === "running"), last = act.jobs[0], pill = $("actToggle");
  pill.classList.toggle("busy", !!run);
  pill.classList.toggle("failed", !run && last?.status === "error");
  let line = "Idle", full = "Nothing running";
  if (run) {
    const pr = jobProgress(run);
    line = `${pr.current ? pr.current.label : run.title} · ${pr.cur + 1}/${pr.n}`;
    full = `${run.title} — step ${pr.cur + 1} of ${pr.n}${pr.current ? ": " + pr.current.message : ""}`;
  } else if (last) { line = STATUS_LBL[last.status]; full = `Last: ${last.title} — ${STATUS_LBL[last.status].toLowerCase()}`; }
  $("actNow").textContent = line;
  pill.title = full;
  tickTimes();
}
function tickTimes() {
  document.querySelectorAll("[data-t0]").forEach((el) => {
    const t1 = el.dataset.t1 ? +el.dataset.t1 : now();
    el.textContent = fmtDur(t1 - +el.dataset.t0);
  });
}
setInterval(tickTimes, 500);

// The pill is always visible; the full timeline opens in a side panel.
function setActivity(open) {
  $("activity").hidden = !open;
  $("actToggle").setAttribute("aria-expanded", String(open));
  if (open) $("actClose").focus();
}
$("actToggle").onclick = () => setActivity($("activity").hidden);
$("actClose").onclick = () => { setActivity(false); $("actToggle").focus(); };
$("activity").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); $("actClose").click(); } });
$("actList").addEventListener("toggle", (e) => {
  const k = e.target.dataset?.key; if (!k) return;
  e.target.open ? act.openDetails.add(k) : act.openDetails.delete(k);
}, true);
$("actList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cancel]"); if (!b) return;
  b.disabled = true; b.textContent = "Cancelling…";
  cancelJob(act.jobs.find((j) => j.job_id === b.dataset.cancel));
});
renderActivity();

// ------------------------------------------------------------------ analyze (real progress)
let analyzing = false, analyzeJob = null;
function showProgress(job) {
  analyzeJob = job;
  const { steps, n, done, current } = jobProgress(job);
  $("progress").hidden = false;
  $("progressTime").dataset.t0 = job.t0;
  if (job.t1) $("progressTime").dataset.t1 = job.t1; else delete $("progressTime").dataset.t1;
  $("progressStages").innerHTML = steps.map((x) => `<li class="${x.status === "running" ? "active" : x.status}">${esc(x.label)}${
    x.message && x.status !== "pending" ? `<span class="stage-msg"> — ${esc(x.message)}</span>` : ""}</li>`).join("");
  $("progressStage").textContent = job.status === "done" ? "Done" : current ? current.message + "…" : "Starting…";
  $("progressFill").style.width = `${job.status === "done" ? 100 : Math.max(4, (100 * (done + (current ? 0.5 : 0))) / n)}%`;
  $("progressCancel").hidden = job.status !== "running";
}
$("progressCancel").onclick = () => { $("progressCancel").textContent = "Cancelling…"; cancelJob(analyzeJob); };
$("progressDetails").onclick = () => setActivity(true);

$("analyzeBtn").onclick = async () => {
  analyzing = true; refreshAnalyze();
  status($("analyzeStatus"), "", "info");
  $("progressCancel").textContent = "Cancel"; $("progressFill").style.width = "0"; $("progressStages").innerHTML = "";
  let ok = false;
  try {
    const d = await runJob("/api/jobs/analyze", { session_id: state.resume.session_id, jd_text: $("jdText").value }, showProgress);
    ok = true;
    state.analysis = d;
    state.selected = new Set(d.changes.map((c) => c.id));
    state.edits = {}; state.filter = "all"; state.kwFilter = null; state.pop = null; state.exported = false; state.prevText = {};
    state.cover = null; state.coverEdited = false;
    state.gaps = {}; state.gapExtra = new Set(); state.gapsSummary = "";
    setTimeout(() => { $("progress").hidden = true; showReview(); }, 350);
  } catch (e) {
    $("progress").hidden = true;
    status($("analyzeStatus"), e.cancelled ? "Analysis cancelled." : e.message, e.cancelled ? "info" : "err");
  } finally { analyzing = false; if (!ok) refreshAnalyze(); }
};

// ------------------------------------------------------------------ keywords
function kwRegex(term) {  // simple plurals either way, like resume_io.kw_regex
  term = term.trim(); if (/(?:[a-z]{3}[^s\W]|[A-Z]{2})s$/.test(term)) term = term.slice(0, -1);
  const t = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+");
  return new RegExp(`(^|[^A-Za-z0-9])${t}(?:s|es)?(?=$|[^A-Za-z0-9])`, "i");
}
const RANK = { required: 0, preferred: 1, nice: 2 };
function prepKeywords() {
  state.kws = (state.analysis.jd.keywords || []).map((k) => ({
    ...k, rank: RANK[k.importance] ?? 2,
    res: [k.term, ...(k.variants || [])].filter(Boolean).map(kwRegex),
  })).sort((a, b) => a.rank - b.rank);
  state.kwAll = state.kws.flatMap((k) => k.res.map((r) => new RegExp(r.source, "gi")));
}
// merged [start, end) spans of every JD keyword in text (same matcher as the counts and the download)
function kwSpans(text) {
  const spans = [];
  for (const re of state.kwAll || []) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(text))) spans.push([m.index + m[1].length, m.index + m[0].length]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of spans) { const l = out[out.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else out.push([a, b]); }
  return out;
}
function boldHtml(text) {
  let html = "", at = 0;
  for (const [a, b] of kwSpans(text)) { html += esc(text.slice(at, a)) + `<strong>${esc(text.slice(a, b))}</strong>`; at = b; }
  return html + esc(text.slice(at));
}
// justified like the download: body text and bullets that wrap; not tab/separator rows or one-liners
const SEP_RE = /\t| {2,}\S| [·|] /;
function justifyOk(kind, raw) {
  const t = raw.trim();
  return (kind === "text" || kind === "bullet") && !t.includes("\n") && !SEP_RE.test(t) && t.length >= 90;
}
// which JD keywords appear in the text (term, variants, simple plurals)
function coverage(text) {
  const hit = new Set();
  for (const k of state.kws) if (k.res.some((r) => r.test(text))) hit.add(k.term);
  return { hit };
}
function currentText(id) {
  const c = state.analysis.changes.find((x) => x.target_id === id && state.selected.has(x.id));
  return c ? state.edits[c.id] ?? c.new_text : null;
}
function fullText(applied) {
  return state.resume.paragraphs.map((p) => (applied ? currentText(p.id) ?? p.text : p.text)).join("\n");
}
function kwForTerm(term) { return state.kws.find((k) => k.term === term); }

// ------------------------------------------------------------------ word diff
function diffOps(a, b) {
  const A = a.split(/(\s+)/).filter((x) => x !== ""), B = b.split(/(\s+)/).filter((x) => x !== "");
  const n = A.length, m = B.length, dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  const push = (t, s) => { const l = out[out.length - 1]; if (l && l.t === t) l.s += s; else out.push({ t, s }); };
  while (i < n && j < m) {
    if (A[i] === B[j]) { push("=", A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) push("-", A[i++]);
    else push("+", B[j++]);
  }
  while (i < n) push("-", A[i++]);
  while (j < m) push("+", B[j++]);
  return out;
}
// one view of the diff (before: drop "+", after: drop "-"), with a space-only gap between two changed
// words folded into the run, so "designing Python REST APIs" highlights as one phrase, not four boxes
function diffView(ops, drop) {
  const v = ops.filter((o) => o.t !== drop), out = [];
  v.forEach((o, k) => {
    const t = o.t === "=" && !o.s.trim() && v[k - 1] && v[k + 1] && v[k - 1].t !== "=" && v[k - 1].t === v[k + 1].t ? v[k - 1].t : o.t;
    const l = out[out.length - 1];
    if (l && l.t === t) l.s += o.s; else out.push({ t, s: o.s });
  });
  return out;
}
const words = (s) => (s.match(/\S+/g) || []).length;
const heavy = (ops, a, b) => ops.filter((o) => o.t !== "=").reduce((n, o) => n + words(o.s), 0) / Math.max(1, words(a) + words(b)) > 0.3;
// Small edits read best inline; heavy rewrites turn inline marks into word soup, so show Before / After.
let diffMode = "auto";
try { diffMode = localStorage.getItem("ro.diffMode") || "auto"; } catch (e) { /* storage blocked */ }
function diffHtml(a, b) {
  const ops = diffOps(a, b);
  const stacked = diffMode === "stacked" || (diffMode === "auto" && heavy(ops, a, b));
  if (!stacked)
    return `<div class="diff">${ops.map((o) => o.t === "=" ? esc(o.s) : o.t === "-" ? `<del>${esc(o.s)}</del>` : `<ins>${esc(o.s)}</ins>`).join("")}</div>`;
  const before = diffView(ops, "+").map((o) => o.t === "-" ? `<del>${esc(o.s)}</del>` : esc(o.s)).join("");
  const after = diffView(ops, "-").map((o) => o.t === "+" ? `<ins>${esc(o.s)}</ins>` : esc(o.s)).join("");
  return `<div class="ba"><div class="ba-row ba-before"><span class="ba-lbl">Before</span><div class="diff">${before}</div></div>
    <div class="ba-row ba-after"><span class="ba-lbl">After</span><div class="diff">${after}</div></div></div>`;
}
function syncDiffButtons() {
  document.querySelectorAll("#diffSeg button").forEach((b) => { const on = b.dataset.d === diffMode; b.classList.toggle("active", on); b.setAttribute("aria-pressed", on); });
}
function setDiffMode(m) {
  diffMode = m;
  try { localStorage.setItem("ro.diffMode", m); } catch (e) { /* storage blocked */ }
  syncDiffButtons(); if (state.pop) renderPop();
}
document.querySelectorAll("#diffSeg button").forEach((b) => { b.onclick = () => setDiffMode(b.dataset.d); });

// ------------------------------------------------------------------ review: the resume page is the surface
function showReview() {
  $("setupView").hidden = true; $("reviewView").hidden = false; $("restartBtn").hidden = false;
  const jd = state.analysis.jd;
  $("rvRole").textContent = [jd.role, jd.company].filter((x) => x && x !== "Not specified").join(" · ") || "Your resume";
  setTabTitle([jd.company, jd.role].filter((x) => x && x !== "Not specified").join(" – "));
  $("rvAssessment").textContent = state.analysis.overall_assessment || jd.summary || "";
  $("rvAssessment").classList.remove("open");
  const notices = state.analysis.notices || [];
  $("rvNotices").hidden = !notices.length;
  $("rvNoticesText").innerHTML = notices.length ? `<b>From the job posting:</b> ${notices.map(esc).join(" ")}` : "";
  syncDiffButtons();
  renderFmtNote(); refreshFileNames();
  prepKeywords();
  setFilter("all");
  closePop();
  window.scrollTo(0, 0);
  update();
  requestAnimationFrame(() => { const a = $("rvAssessment"); $("rvMore").hidden = a.scrollHeight <= a.clientHeight + 2; $("rvMore").textContent = "More"; });
  updateSteps();
}
$("rvMore").onclick = () => {
  const open = $("rvAssessment").classList.toggle("open");
  $("rvMore").textContent = open ? "Less" : "More";
};
$("rvNoticeClose").onclick = () => { $("rvNotices").hidden = true; };

const TYPE_LABEL = { reword: "Reworded", keyword: "Keyword", quantify: "Impact", reorder: "Reordered", tighten: "Tightened", summary: "Summary" };
const byId = (id) => state.analysis.changes.find((c) => c.id === id);
const norm = (t) => t.replace(/\t+/g, "   ").replace(/^\s+/, "");  // tabs as spaces; drop e.g. a leading column break

function matchesFilter(c) {
  const on = state.selected.has(c.id);
  if (state.filter === "on" && !on) return false;
  if (state.filter === "off" && on) return false;
  if (state.kwFilter) {
    const k = kwForTerm(state.kwFilter), txt = state.edits[c.id] ?? c.new_text;
    const tagged = (c.jd_keywords || []).some((t) => t.toLowerCase() === state.kwFilter.toLowerCase());
    if (!tagged && !(k && k.res.some((r) => r.test(txt)))) return false;
  }
  return true;
}
function visibleEdits() { return state.analysis.changes.filter(matchesFilter); }

// The page shows the final text as it will download: keywords bold, body justified. Review cues
// (a left rule on edits, dotted underline on skipped ones, the current edit) are screen-only.
function renderPage() {
  const page = $("preview"), show = $("hlToggle").checked, bold = state.cfg.bold_keywords !== false;
  const byTarget = Object.fromEntries(state.analysis.changes.map((c) => [c.target_id, c]));
  const firstRender = !Object.keys(state.prevText).length;
  let first = true, body = false, html = "";
  for (const p of state.resume.paragraphs) {
    const c = byTarget[p.id], blank = !p.text.trim();
    if (p.kind === "heading") body = true;
    const on = c && state.selected.has(c.id), raw = c ? (on ? state.edits[c.id] ?? c.new_text : c.original_text) : p.text;
    const finalTxt = norm(raw), isBody = body && p.kind !== "heading";
    let cls = `pp ${p.kind}` + (first && !blank ? " first" : "") + (isBody && justifyOk(p.kind, raw) ? " just" : ""), attrs = "";
    if (!blank) first = false;
    const inner = isBody && bold ? boldHtml(finalTxt) : esc(finalTxt);
    if (c) {
      const vis = matchesFilter(c);
      cls += ` edit ${on ? "on" : "off"}${vis ? " marked" : ""}${show ? "" : " quiet"}${(c.warnings || []).length ? " flagged" : ""}${state.pop === c.id ? " current" : ""}`;
      attrs = ` data-change="${esc(c.id)}" tabindex="0" role="button" aria-label="${on ? "Accepted" : "Skipped"} edit: ${esc(c.reason)}"`;
    }
    if (!firstRender && state.prevText[p.id] !== finalTxt) cls += " fresh";
    state.prevText[p.id] = finalTxt;
    html += `<div class="${cls}" id="pp-${esc(p.id)}"${attrs}>${inner}</div>`;
  }
  page.innerHTML = html;
}
$("preview").addEventListener("click", (e) => {
  const el = e.target.closest(".edit"); if (el) openPop(el.dataset.change);
});
$("preview").addEventListener("keydown", (e) => {
  const el = e.target.closest(".edit");
  if (el && (e.key === "Enter" || (e.key === " " && state.pop !== el.dataset.change))) { e.preventDefault(); openPop(el.dataset.change); }
});

// ------------------------------------------------------------------ the edit popover
function openPop(id) {
  if (!byId(id)) return;
  state.pop = id;
  renderPage(); renderPop();
  const el = document.querySelector(`[data-change="${CSS.escape(id)}"]`);
  if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  setTimeout(positionPop, 260);
}
function closePop() {
  const had = state.pop; state.pop = null;
  $("editPop").hidden = true;
  if (had && !$("reviewView").hidden) {
    renderPage();
    const el = document.querySelector(`[data-change="${CSS.escape(had)}"]`);
    if (el && $("editPop").contains(document.activeElement)) el.focus();
  }
}
function renderPop() {
  const c = byId(state.pop), pop = $("editPop");
  if (!c) return closePop();
  const on = state.selected.has(c.id), cur = state.edits[c.id] ?? c.new_text, edited = c.id in state.edits;
  const list = visibleEdits(), at = list.findIndex((x) => x.id === c.id);
  const badge = c.source === "add" ? `<span class="tag lilac" title="Claude added ${esc(c.from_input)} from work your resume already shows. Skip it if it isn't accurate">Added by Claude</span>`
    : c.from_input ? `<span class="tag sky" title="Added from what you told Claude about ${esc(c.from_input)}">From your input</span>` : "";
  const type = TYPE_LABEL[c.type] || c.type, sec = c.section.toLowerCase() === String(type).toLowerCase() ? c.section : `${c.section} · ${type}`;
  pop.innerHTML = `
    <div class="pop-head"><span class="pop-sec">${esc(sec)}</span>${badge}${edited ? '<span class="tag">Edited by you</span>' : ""}
      <span class="pop-nav"><button type="button" class="ghost icon sm pop-prev" aria-label="Previous edit" ${at <= 0 ? "disabled" : ""}>‹</button>
      <span class="muted small">${at >= 0 ? at + 1 : "–"} of ${list.length}</span>
      <button type="button" class="ghost icon sm pop-next" aria-label="Next edit" ${at < 0 || at >= list.length - 1 ? "disabled" : ""}>›</button></span>
      <button type="button" class="ghost icon sm pop-close" aria-label="Close">✕</button></div>
    <p class="pop-reason" id="popTitle">${esc(c.reason)}</p>
    <div class="pop-diff">${diffHtml(c.original_text, cur)}</div>
    ${(c.jd_keywords || []).length ? `<div class="pop-kws">${c.jd_keywords.map((k) => `<span class="tag sky">${esc(k)}</span>`).join("")}</div>` : ""}
    ${(c.warnings || []).map((w) => `<div class="warn">${esc(w)}</div>`).join("")}
    <div class="pop-editor" hidden><textarea id="popText" rows="4" aria-label="Edit this paragraph"></textarea>
      <div class="pop-row"><button type="button" class="primary sm pop-save">Save edit</button><button type="button" class="ghost sm pop-cancel">Cancel</button></div></div>
    <div class="pop-row pop-actions">
      <button type="button" class="${on ? "primary" : "secondary"} pop-accept" aria-pressed="${on}">${on ? "✓ Accepted" : "Accept"}</button>
      <button type="button" class="${on ? "secondary" : "primary"} pop-skip" aria-pressed="${!on}">${on ? "Skip" : "Skipped"}</button>
      <button type="button" class="ghost pop-edit">Edit</button>
      ${edited ? '<button type="button" class="ghost pop-reset">Reset</button>' : ""}
    </div>`;
  pop.hidden = false;
  positionPop();
}
function positionPop() {
  const pop = $("editPop"), el = state.pop && document.querySelector(`[data-change="${CSS.escape(state.pop)}"]`);
  if (pop.hidden || !el) return;
  if (getComputedStyle(pop).position === "fixed") return;  // bottom sheet on phones / touch
  const r = el.getBoundingClientRect(), page = $("preview").getBoundingClientRect();
  const w = Math.min(480, page.width - 16);
  pop.style.width = `${w}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left, page.right - w - 8)) + scrollX}px`;
  pop.style.top = `${r.bottom + scrollY + 8}px`;
}
function stepPop(dir) {
  const list = visibleEdits(); if (!list.length) return;
  const at = list.findIndex((x) => x.id === state.pop);
  const next = at < 0 ? (dir > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, at + dir));
  openPop(list[next].id);
}
function toggleChange(id, on) {
  const want = on ?? !state.selected.has(id);
  want ? state.selected.add(id) : state.selected.delete(id);
  update();
}
function openPopEditor() {
  const c = byId(state.pop); if (!c) return;
  const ed = $("editPop").querySelector(".pop-editor"), ta = $("popText");
  ed.hidden = false; ta.value = state.edits[c.id] ?? c.new_text;
  ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px";
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}
$("editPop").addEventListener("click", (e) => {
  const c = byId(state.pop); if (!c) return;
  const b = e.target.closest("button"); if (!b) return;
  if (b.matches(".pop-close")) return closePop();
  if (b.matches(".pop-accept")) return toggleChange(c.id, true);
  if (b.matches(".pop-skip")) return toggleChange(c.id, false);
  if (b.matches(".pop-edit")) return openPopEditor();
  if (b.matches(".pop-cancel")) { $("editPop").querySelector(".pop-editor").hidden = true; return; }
  if (b.matches(".pop-save")) {
    const v = $("popText").value.trim();
    if (v && v !== c.new_text) state.edits[c.id] = v; else delete state.edits[c.id];
    state.selected.add(c.id); update(); toast("Edit saved", "ok"); return;
  }
  if (b.matches(".pop-reset")) { delete state.edits[c.id]; update(); return; }
  if (b.matches(".pop-prev")) return stepPop(-1);
  if (b.matches(".pop-next")) return stepPop(1);
});
$("editPop").addEventListener("keydown", (e) => {
  if (e.target.id === "popText" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) $("editPop").querySelector(".pop-save").click();
  if (e.target.id === "popText" && e.key === "Escape") { e.stopPropagation(); $("editPop").querySelector(".pop-editor").hidden = true; }
});
$("editPop").addEventListener("input", (e) => { if (e.target.id === "popText") { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; } });
document.addEventListener("pointerdown", (e) => {
  if (!state.pop || e.target.closest("#editPop, .edit, #moreMenu, dialog, .toasts")) return;
  closePop();
});
window.addEventListener("resize", positionPop);

// ------------------------------------------------------------------ filters, menu
function setFilter(f) {
  state.filter = f;
  document.querySelectorAll("#filterSeg button").forEach((x) => { const on = x.dataset.f === f; x.classList.toggle("active", on); x.setAttribute("aria-pressed", on); });
}
document.querySelectorAll("#filterSeg button").forEach((b) => { b.onclick = () => { setFilter(b.dataset.f); closePop(); update(); }; });
function setKwFilter(term) {
  state.kwFilter = term; closePop(); update();
  const list = visibleEdits();
  if (term && list.length) {
    const el = document.querySelector(`[data-change="${CSS.escape(list[0].id)}"]`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  } else if (term) {
    const k = kwForTerm(term), inResume = k && k.res.some((r) => r.test(fullText(false)));
    toast(inResume ? `“${term}” was already in your resume.` : `No edit adds “${term}”.`);
  }
}
function toggleMenu(open) {
  const m = $("moreMenu"); open = open ?? m.hidden;
  m.hidden = !open; $("moreBtn").setAttribute("aria-expanded", String(open));
  if (open) m.querySelector(".menu-item").focus();
}
$("moreBtn").onclick = (e) => { e.stopPropagation(); toggleMenu(); };
document.addEventListener("click", (e) => { if (!$("moreMenu").hidden && !e.target.closest(".menu-wrap")) toggleMenu(false); });
$("moreMenu").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); toggleMenu(false); $("moreBtn").focus(); } });
$("selAll").onclick = () => { state.selected = new Set(state.analysis.changes.map((c) => c.id)); toggleMenu(false); update(); toast("All edits accepted"); };
$("selNone").onclick = () => { state.selected.clear(); toggleMenu(false); update(); toast("All edits skipped"); };
$("hlToggle").onchange = () => update();

// ------------------------------------------------------------------ keywords panel
function openKw() { hideTip(); if (!$("kwDlg").open) $("kwDlg").show(); $("kwClose").focus(); }
function closeKw() { hideTip(); if ($("kwDlg").open) $("kwDlg").close(); }
$("kwSummaryBtn").onclick = openKw;
$("kwClose").onclick = closeKw;
$("kwDlg").addEventListener("keydown", (e) => { if (e.key === "Escape" && $("kwTip").hidden) { e.preventDefault(); closeKw(); $("kwSummaryBtn").focus(); } });
$("kwDlg").addEventListener("cancel", (e) => e.preventDefault());
$("kwGaps").onclick = () => { closeKw(); openGaps(); };
$("kwIn").addEventListener("click", (e) => {
  const ch = e.target.closest(".chip"); if (!ch) return;
  closeKw(); setKwFilter(state.kwFilter === ch.dataset.term ? null : ch.dataset.term);
});

// ------------------------------------------------------------------ fill the gaps: every "Not added" keyword, one request
// state.gaps[term] = { choice: "add"|"note"|"skip", note, role, status: "draft"|"added"|"missed", reply, changeId }
//   add  = Claude researches the keyword and writes it in from the resume    note = the user's quick idea
//   skip = not for this job: never sent, stays skipped until the user picks another option (until a new job)
//   added = an edit carrying it is on the page    missed = no line could take it (rare: no Skills line either)
let gapsJob = null;
const CONTACT = /[\w.+-]+@[\w-]+\.\w|linkedin|github/i;
// roles = dated employer lines ("Acme Corp  Jan 2022 – Present"), plus the job title on the next line
function roleOptions() {
  const ps = state.resume.paragraphs.filter((p) => p.text.trim() && p.kind !== "bullet"), out = [];
  const clean = (t) => t.replace(/\t+/g, " · ").replace(/\s{2,}/g, " ").trim();
  const dated = (t) => t.length < 140 && /\b(19|20)\d{2}\b|\bpresent\b/i.test(t) && !CONTACT.test(t);
  ps.forEach((p, i) => {
    if (p.section === "Header" || !dated(p.text) || /education|degree|university|college|b\.?s\.?|m\.?s\./i.test(p.section + p.text)) return;
    const next = ps[i + 1];
    const title = next && !dated(next.text) && next.kind !== "heading" && next.text.trim().length <= 60 ? ` — ${clean(next.text)}` : "";
    out.push(clean(p.text) + title);
  });
  return [...new Set(out)];
}
function gap(term) { return state.gaps[term] ??= { choice: "add", note: "", role: "", status: "draft" }; }
function inResumeNow(term) { const k = kwForTerm(term); return !!k && k.res.some((r) => r.test(fullText(true))); }
function gapStatus(term) {
  const g = gap(term), nowIn = inResumeNow(term);
  if (g.status === "added") return nowIn ? "added" : "draft";      // its edit was skipped later: a gap again
  return g.status;
}
// only open gaps: once a keyword is in the resume its row goes away (the summary line says what was added)
function gapTerms() {
  return [...state.kws.map((k) => k.term).filter((t) => !inResumeNow(t)),
    ...[...state.gapExtra].filter((t) => !kwForTerm(t) && gapStatus(t) !== "added")];
}
function gapReady(term) {
  const g = gap(term), st = gapStatus(term);
  return st !== "added" && g.choice !== "skip" && !(g.choice === "note" && !g.note.trim());
}
function changeAdds(c, k) { return k.res.some((r) => r.test(state.edits[c.id] ?? c.new_text)); }
function gapReason(k) {
  const skipped = state.analysis.changes.find((c) => !state.selected.has(c.id) && changeAdds(c, k));
  if (skipped) return { text: "A suggested edit adds this, but you skipped it.", change: skipped.id };
  const g = (state.analysis.keyword_gaps || []).find((x) => x.term.trim().toLowerCase() === k.term.trim().toLowerCase());
  if (g) return { text: g.reason };
  return { text: "Your resume doesn't mention this yet." };
}

function gapRowHtml(term, i, roles) {
  const k = kwForTerm(term), g = gap(term), st = gapStatus(term);
  const imp = k ? k.importance || "" : "suggested";
  const head = `<div class="gap-head"><b>${esc(term)}</b>${imp === "required" ? '<span class="req-star" title="Required">★</span>' : ""}
    <span class="gap-imp">${esc(imp)}</span>${g.choice === "skip" ? '<span class="tag">Skipped</span>' : ""}</div>`;
  const reason = k ? gapReason(k) : { text: "Claude suggested this as worth adding." };
  if (reason.change)
    return `<div class="gap-row" data-term="${esc(term)}">${head}<div class="gap-reason small muted">${esc(reason.text)}</div>
      <button type="button" class="secondary sm gap-include" data-change="${esc(reason.change)}">Accept that edit</button></div>`;
  const opt = (c, label) => `<button type="button" role="radio" data-c="${c}" class="${g.choice === c ? "active" : ""}" aria-checked="${g.choice === c}">${label}</button>`;
  const why = g.choice === "skip" ? "Won't be added to your resume." : st === "missed" && g.reply ? g.reply.explanation : reason.text;
  return `<div class="gap-row ${st}${g.choice === "skip" ? " skipped" : ""}" data-term="${esc(term)}">${head}
    <div class="gap-reason small muted">${esc(why)}</div>
    <div class="seg gap-choice" role="radiogroup" aria-label="How should Claude handle ${esc(term)}?">
      ${opt("add", "Add it")}${opt("note", "Describe it")}${opt("skip", "Skip")}
    </div>
    <div class="gap-form"${g.choice === "note" ? "" : " hidden"}>
      <label class="label" for="gapNote${i}">Your idea, in a few words</label>
      <textarea id="gapNote${i}" rows="2" data-note placeholder="e.g. used it for the billing dashboard at Acme">${esc(g.note)}</textarea>
      <select data-role aria-label="Which role was this in? (optional)"><option value="">Claude picks the role</option>${
        roles.map((r) => `<option${r === g.role ? " selected" : ""}>${esc(r)}</option>`).join("")}</select>
    </div></div>`;
}
// suggestions that don't name a missing keyword are advice; the rest already appear as rows
function suggestionTerms(text) {
  const nowTxt = fullText(true);
  return (state.kws || []).filter((k) => k.res.some((r) => r.test(text)) && !k.res.some((r) => r.test(nowTxt))).map((k) => k.term);
}
function renderAdvice() {
  const advice = (state.analysis.suggestions || []).filter((x) => !suggestionTerms(`${x.text} ${x.reason}`).length
    && !(state.kws || []).some((k) => k.res.some((r) => r.test(`${x.text} ${x.reason}`))));
  $("gapsAdvice").hidden = !advice.length;
  $("gapsAdvice").innerHTML = advice.length ? `<h4>Also worth considering</h4><ul>${advice.map((x) => `<li><b>${esc(x.text)}</b> <span class="muted">${esc(x.reason)}</span></li>`).join("")}</ul>` : "";
}
function renderGaps() {
  const terms = gapTerms(), roles = roleOptions();
  $("gapsList").innerHTML = terms.length ? terms.map((t, i) => gapRowHtml(t, i, roles)).join("")
    : `<div class="muted gap-empty">${state.gapsSummary ? "Nothing left to add." : "Every keyword from the job is in your resume."}</div>`;
  $("gapsList").querySelectorAll("textarea").forEach(autosize);
  $("gapsSummary").hidden = !state.gapsSummary; $("gapsSummary").textContent = state.gapsSummary || "";
  renderAdvice();
  refreshGapsFooter();
}
function refreshGapsFooter() {
  const ready = gapTerms().filter(gapReady), n = ready.length, running = gapsJob && gapsJob.status === "running";
  const open = gapTerms().filter((t) => gap(t).choice !== "skip"), all = n === open.length;
  $("gapsSubmit").disabled = !n || running;
  const allSkipped = gapTerms().length > 0 && !open.length;
  $("gapsSkipAll").hidden = !gapTerms().length; $("gapsSkipAll").disabled = running;
  $("gapsSkipAll").textContent = allSkipped ? "Unskip all" : "Skip all";
  if (!running) $("gapsSubmit").textContent = !n ? (open.length ? "Write a quick note to continue" : "Nothing to add")
    : n === 1 ? "Add 1 keyword" : `Add ${all ? "all " : ""}${n} ${all ? "missing " : ""}keywords`;
  $("gapsCancel").textContent = running ? "Stop" : "Close";
}
// terms: nothing (all gaps), or one or more keywords to highlight
function openGaps(terms) {
  hideTip(); closePop(); closeKw();
  terms = [].concat(terms || []).filter(Boolean);
  terms.forEach((t) => { if (!kwForTerm(t)) state.gapExtra.add(t); });
  renderGaps();
  if (!$("gapsDlg").open) $("gapsDlg").show();  // non-modal: the Activity pill stays usable
  const rows = [...$("gapsList").querySelectorAll(".gap-row")].filter((r) => terms.includes(r.dataset.term));
  if (rows.length) {
    rows[0].scrollIntoView({ block: "center" });
    (terms.length === 1 && rows[0].querySelector("textarea:not([hidden])") || rows[0].querySelector("[data-c]") || rows[0]).focus?.();
    rows.forEach((r) => { r.classList.add("focus-row"); setTimeout(() => r.classList.remove("focus-row"), 1600); });
  } else ($("gapsList").querySelector("[data-c]") || $("gapsClose")).focus();
}
function closeGaps() { if ($("gapsDlg").open) $("gapsDlg").close(); }
$("gapsOpen").onclick = () => openGaps();
$("gapsClose").onclick = closeGaps;
$("gapsCancel").onclick = () => { if (gapsJob && gapsJob.status === "running") cancelJob(gapsJob); else closeGaps(); };
$("gapsDlg").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeGaps(); } });
function focusEdit(id) {
  const c = byId(id); if (!c) return;
  if (!matchesFilter(c)) { setFilter("all"); state.kwFilter = null; }
  openPop(id);
}
$("gapsList").addEventListener("click", (e) => {
  const row = e.target.closest(".gap-row"); if (!row) return;
  const term = row.dataset.term, g = gap(term);
  const c = e.target.closest("[data-c]");
  if (c) {
    g.choice = c.dataset.c;
    const i = [...$("gapsList").querySelectorAll(".gap-row")].indexOf(row);
    row.outerHTML = gapRowHtml(term, i, roleOptions());
    const now = $("gapsList").querySelector(`.gap-row[data-term="${CSS.escape(term)}"]`);
    if (g.choice === "note") { const ta = now.querySelector("textarea"); autosize(ta); ta.focus(); }
    else now.querySelector(`[data-c="${g.choice}"]`).focus();
    return refreshGapsFooter();
  }
  const inc = e.target.closest(".gap-include");
  if (inc) { state.selected.add(inc.dataset.change); update(); toast(`Accepted the edit that adds ${term}`, "ok"); return; }
  const see = e.target.closest(".gap-see");
  if (see) { closeGaps(); focusEdit(see.dataset.see); }
});
$("gapsSkipAll").onclick = () => {
  const terms = gapTerms(), skip = terms.some((t) => gap(t).choice !== "skip");
  terms.forEach((t) => { gap(t).choice = skip ? "skip" : "add"; });
  renderGaps();
};
$("gapsList").addEventListener("input", (e) => {
  const row = e.target.closest(".gap-row"); if (!row || !e.target.matches("[data-note]")) return;
  gap(row.dataset.term).note = e.target.value;
  autosize(e.target);
  refreshGapsFooter();
});
$("gapsList").addEventListener("change", (e) => {
  const row = e.target.closest(".gap-row"); if (row && e.target.matches("[data-role]")) gap(row.dataset.term).role = e.target.value;
});
$("gapsSubmit").onclick = async () => {
  const terms = gapTerms().filter(gapReady); if (!terms.length) return;
  const items = terms.map((t) => ({ term: t, mode: gap(t).choice, justification: gap(t).choice === "note" ? gap(t).note.trim() : "", role: gap(t).role }));
  $("gapsSubmit").disabled = true; $("gapsSubmit").textContent = `Adding ${items.length} keyword${items.length === 1 ? "" : "s"}…`;
  status($("gapsStatus"), "Starting…", "info", true);
  try {
    const d = await runJob("/api/jobs/justify_keywords", { session_id: state.resume.session_id, items, accepted: acceptedEdits() }, (job) => {
      gapsJob = job; refreshGapsFooter();
      const { current, cur, n } = jobProgress(job);
      if (job.status === "running" && current) status($("gapsStatus"), `${current.message}… (step ${cur + 1} of ${n})`, "info", true);
    });
    for (const x of d.decisions) {
      const g = gap(x.term);
      g.reply = x;
      const carrier = d.changes.find((c) => (c.jd_keywords || []).includes(x.term));
      g.status = carrier ? "added" : "missed"; g.changeId = carrier ? carrier.id : null;
    }
    const added = d.decisions.filter((x) => gap(x.term).status === "added").length, more = d.decisions.length - added;
    const weak = d.decisions.filter((x) => gap(x.term).status === "added" && x.evidence === "weak").length;
    state.gapsSummary = [added && `Added ${added}`, weak && `${weak} to double-check`, more && `${more} couldn't be placed`]
      .filter(Boolean).join(" · ");
    status($("gapsStatus"), "", "info");
    if (d.changes.length) mergeChanges(d.changes);
    gapsJob = null; renderGaps();
    toast(state.gapsSummary, added ? "ok" : "");
  } catch (err) { status($("gapsStatus"), err.cancelled ? "Stopped." : err.message, err.cancelled ? "info" : "err"); }
  finally { gapsJob = null; refreshGapsFooter(); }
};

// new edits replace any existing edit on the same paragraph (they already build on its text)
function mergeChanges(newChanges) {
  const targets = new Set(newChanges.map((c) => c.target_id));
  for (const old of state.analysis.changes.filter((c) => targets.has(c.target_id))) {
    state.selected.delete(old.id); delete state.edits[old.id];
    if (state.pop === old.id) state.pop = null;
  }
  const pos = Object.fromEntries(state.resume.paragraphs.map((p, n) => [p.id, n]));  // reading order
  state.analysis.changes = state.analysis.changes.filter((c) => !targets.has(c.target_id)).concat(newChanges)
    .sort((a, b) => (pos[a.target_id] ?? 0) - (pos[b.target_id] ?? 0));
  // keyword edits go straight in; the user can still skip any of them on the page
  newChanges.forEach((c) => state.selected.add(c.id));
  setFilter("all"); state.kwFilter = null;
  update();
  newChanges.forEach((c) => { const el = document.querySelector(`[data-change="${CSS.escape(c.id)}"]`); if (el) el.classList.add("added-now"); });
}

// ------------------------------------------------------------------ "why not added" tooltip (in the Keywords panel)
let tipHideTimer = null, tipChip = null, tipShownAt = 0, tipRefocus = false;
function showTip(chip) {
  clearTimeout(tipHideTimer);
  const k = kwForTerm(chip.dataset.term); if (!k) return;
  const r = gapReason(k), tip = $("kwTip");
  tip.innerHTML = `<div class="tip-head"><b>${esc(k.term)}</b><span class="muted small">${esc(k.importance || "")}</span>
      <button type="button" class="ghost icon sm tip-close" aria-label="Close">✕</button></div>
    <div>${esc(r.text)}</div>
    <div class="tip-actions">${r.change ? `<button class="secondary sm tip-include" data-change="${esc(r.change)}">Accept that edit</button>` : ""}
      <button class="primary sm tip-justify" data-justify="${esc(k.term)}">I have experience with this →</button></div>`;
  if (tipChip !== chip || tip.hidden) tipShownAt = performance.now();
  tip.hidden = false; tipChip = chip;
  chip.setAttribute("aria-describedby", "kwTip");
  if (getComputedStyle(tip).position === "fixed" && matchMedia("(pointer: coarse), (max-width: 620px)").matches) return;  // bottom sheet
  const box = chip.getBoundingClientRect();
  const left = Math.max(12, Math.min(box.left, document.documentElement.clientWidth - tip.offsetWidth - 12));
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.min(box.bottom + 6, innerHeight - tip.offsetHeight - 12)}px`;
}
function hideTip() {
  clearTimeout(tipHideTimer);
  $("kwTip").hidden = true;
  if (tipChip) tipChip.removeAttribute("aria-describedby");
  tipChip = null;
}
document.querySelector("#kwDlg .sheet-body").addEventListener("scroll", hideTip, { passive: true });
const hideTipSoon = () => { clearTimeout(tipHideTimer); tipHideTimer = setTimeout(hideTip, 250); };
const kwOut = $("kwOut");
// hover behaviour only for a real mouse; touch opens/closes by tapping
kwOut.addEventListener("pointerover", (e) => {
  if (e.pointerType !== "mouse") return;
  const ch = e.target.closest(".chip"); if (ch && ch !== tipChip) showTip(ch); else clearTimeout(tipHideTimer);
});
kwOut.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hideTipSoon(); });
kwOut.addEventListener("focusin", (e) => { const ch = e.target.closest(".chip"); if (ch && !tipRefocus) showTip(ch); });
kwOut.addEventListener("focusout", (e) => { if (!$("kwTip").contains(e.relatedTarget)) hideTipSoon(); });
kwOut.addEventListener("click", (e) => {  // tap on touch screens
  const ch = e.target.closest(".chip"); if (!ch) return;
  // a tap fires mouseover then click: don't let the click undo the open that just happened
  if (tipChip === ch && !$("kwTip").hidden && performance.now() - tipShownAt > 400) hideTip(); else showTip(ch);
});
$("kwTip").addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") clearTimeout(tipHideTimer); });
$("kwTip").addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hideTipSoon(); });
$("kwTip").addEventListener("focusout", (e) => { if (!$("kwTip").contains(e.relatedTarget) && e.relatedTarget !== tipChip) hideTipSoon(); });
$("kwTip").addEventListener("click", (e) => {
  if (e.target.closest(".tip-close")) return hideTip();
  const j = e.target.closest("[data-justify]");
  if (j) { hideTip(); return openGaps([j.dataset.justify]); }
  const b = e.target.closest("[data-change]"); if (!b) return;
  state.selected.add(b.dataset.change); hideTip(); update();
  toast("Edit accepted", "ok");
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || $("kwTip").hidden) return;
  const ch = tipChip, inTip = $("kwTip").contains(document.activeElement);
  hideTip(); e.stopPropagation();
  if (ch && inTip) { tipRefocus = true; ch.focus(); tipRefocus = false; }  // return focus without reopening
}, true);
document.addEventListener("click", (e) => {
  if ($("kwTip").hidden || e.target.closest("#kwTip, #kwOut")) return;
  if (performance.now() - tipShownAt > 400) hideTip();  // the tap that opened it can land elsewhere
});

// ------------------------------------------------------------------ update (live)
function update() {
  const changes = state.analysis.changes, n = state.selected.size;
  $("selCount").textContent = changes.length ? `${n} of ${changes.length} edits accepted` : "No edits needed";
  $("exportBtn").title = n ? `Download your resume with ${n} edit${n === 1 ? "" : "s"}` : "Download your resume unchanged";
  const kf = $("kwFilter");
  kf.hidden = !state.kwFilter;
  if (state.kwFilter) {
    kf.innerHTML = `Adds “${esc(state.kwFilter)}” <button type="button" aria-label="Clear keyword filter">✕</button>`;
    kf.querySelector("button").onclick = () => setKwFilter(null);
  }
  renderPage();

  // keyword line + panel
  const before = coverage(fullText(false)), after = coverage(fullText(true));
  const total = state.kws.length, had = before.hit.size, nowN = after.hit.size, added = nowN - had, missing = total - nowN;
  $("kwLine").textContent = `${nowN} of ${total} keywords`;
  $("kcDelta").textContent = added > 0 ? `+${added}` : "";
  $("kcDelta").title = added > 0 ? `${added} added by your edits` : "";
  $("kwMissing").textContent = missing ? `${missing} missing` : "all covered";
  $("kwStats").textContent = `Your resume had ${had}. With your edits it has ${nowN} of the ${total} keywords in this job.`;
  $("kcBarHad").style.width = `${total ? (100 * Math.min(had, nowN)) / total : 0}%`;
  $("kcBarAdded").style.width = `${total ? (100 * Math.max(0, added)) / total : 0}%`;
  const req = state.kws.filter((k) => k.importance === "required");
  $("kcReq").textContent = req.length ? `Required: ${req.filter((k) => after.hit.has(k.term)).length} of ${req.length} covered` : "";
  $("kcLive").textContent = `Your resume now has ${nowN} of ${total} keywords.`;
  const inKw = state.kws.filter((k) => after.hit.has(k.term)), outKw = state.kws.filter((k) => !after.hit.has(k.term));
  $("kwIn").innerHTML = inKw.map((k) => `<button class="chip in${k.term === state.kwFilter ? " active" : ""}" data-term="${esc(k.term)}" title="Show the edits that add it">${esc(k.term)}${
    before.hit.has(k.term) ? "" : ' <span class="new-tag">new</span>'}</button>`).join("") || '<span class="muted small">None yet.</span>';
  const outChip = (k) => `<button class="chip out${k.importance === "required" ? " req" : ""}${k.category === "soft_skill" ? " soft" : ""}" data-term="${esc(k.term)}">${esc(k.term)}</button>`;
  const hard = outKw.filter((k) => k.category !== "soft_skill"), soft = outKw.filter((k) => k.category === "soft_skill");
  $("kwOut").innerHTML = (hard.map(outChip).join("")
    + (soft.length ? `<div class="kw-sub">Soft skills, usually shown through your bullets rather than listed</div>${soft.map(outChip).join("")}` : ""))
    || '<span class="muted small">Every keyword is covered.</span>';
  $("kwInCount").textContent = `(${inKw.length})`; $("kwOutCount").textContent = `(${outKw.length})`;
  $("gapsOpen").hidden = !outKw.length; $("kwGaps").hidden = !outKw.length;
  $("gapsOpen").textContent = `Add ${outKw.length} keyword${outKw.length === 1 ? "" : "s"}`;
  if ($("gapsDlg").open && !gapsJob) renderGaps();
  hideTip();
  if (state.pop) renderPop();
}

// ------------------------------------------------------------------ keyboard
document.addEventListener("keydown", (e) => {
  if ($("reviewView").hidden || document.querySelector("dialog[open]")) return;  // panels have their own keys
  if (e.target.closest("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === " " && e.target.closest("button, summary")) return;
  switch (e.key) {
    case "j": case "ArrowDown": if (!visibleEdits().length) return; stepPop(1); break;
    case "k": case "ArrowUp": if (!visibleEdits().length) return; stepPop(-1); break;
    case " ": case "x": if (!state.pop) return; toggleChange(state.pop); break;
    case "e": if (!state.pop) return; openPopEditor(); break;
    case "a": $("selAll").click(); break;
    case "n": $("selNone").click(); break;
    case "h": $("hlToggle").checked = !$("hlToggle").checked; update(); break;
    case "Escape": if (!$("moreMenu").hidden) toggleMenu(false); else if (state.pop) closePop(); else if (state.kwFilter) setKwFilter(null); else return; break;
    default: return;
  }
  e.preventDefault();
});

$("restartBtn").onclick = () => {
  closePop(); closeGaps(); closeKw();
  $("reviewView").hidden = true; $("coverView").hidden = true; $("setupView").hidden = false; $("restartBtn").hidden = true;
  state.gaps = {}; state.gapExtra = new Set(); state.gapsSummary = "";
  state.cover = null; state.coverEdited = false; $("cvManager").value = ""; $("cvWhy").value = ""; status($("cvStatus"), "", "info");
  fetchSeq++; if (fetchJob) cancelJob(fetchJob); fetchJob = null; fetchedUrl = "";
  $("fetchBtn").disabled = false; $("fetchBtn").textContent = "Fetch";
  $("jdUrl").value = ""; $("jdText").value = ""; $("jdBox").hidden = true; status($("jdStatus"), "", "info");
  state.exported = false;
  setTabTitle("");
  window.scrollTo(0, 0);
  refreshAnalyze();
};

// ------------------------------------------------------------------ download
function acceptedEdits() {
  return state.analysis.changes.filter((c) => state.selected.has(c.id))
    .map((c) => ({ target_id: c.target_id, new_text: state.edits[c.id] ?? c.new_text }));
}
function triggerDownload(d) {
  const a = document.createElement("a"); a.href = d.download_url; a.download = d.file_name;
  document.body.appendChild(a); a.click(); a.remove();
}
// what: "resume" | "cover" | "both"
async function doExport(what, btn, statusEl) {
  const jd = state.analysis.jd;
  btn.disabled = true;
  status(statusEl, "Preparing your download…", "info", true);
  try {
    const d = await runJob("/api/jobs/export", {
      session_id: state.resume.session_id, accepted: acceptedEdits(), output_dir: state.outDir || null,
      company: jd.company || "", role: jd.role || "",
      include_resume: what !== "cover", cover_letter: what === "resume" ? null : gatherLetter(),
      bold_letter_keywords: $("cvBoldKw").checked,
    }, (job) => { const { current } = jobProgress(job); if (job.status === "running" && current) status(statusEl, current.message + "…", "info", true); });
    const file = what === "both" ? d.zip : what === "cover" ? d.cover : d;
    const saved = [what !== "cover" && d.files, what !== "resume" && d.cover?.files].filter(Boolean).flat().map((f) => f.path);
    status(statusEl, "", "info");
    triggerDownload(file);
    state.exported = true; updateSteps();
    const name = (p) => p.split(/[\\/]/).pop(), folder = (p) => p.split(/[\\/]/).slice(-2, -1)[0] || "/";
    toast(`Saved ${saved.map(name).join(" and ")} in ${folder(saved[0])}`, "ok");
    (d.notices || []).forEach((n) => toast(n, "err"));
    if (what !== "cover" && d.pages > 1) toast(`Your resume PDF runs to ${d.pages} pages. Skip or tighten an edit if you want one page.`, "info");
  } catch (e) { status(statusEl, e.cancelled ? "Download cancelled." : e.message, e.cancelled ? "info" : "err"); }
  finally { btn.disabled = false; }
}
$("exportBtn").onclick = () => doExport("resume", $("exportBtn"), $("exportStatus"));

// ------------------------------------------------------------------ cover letter
let coverJob = null;
const wordCount = (s) => (s.trim().match(/\S+/g) || []).length;
function contactHeader() {
  const out = [];
  for (const p of state.resume.paragraphs) {
    if (p.kind === "heading") break;
    const t = (currentText(p.id) ?? p.text).replace(/\t+/g, "  ").trim();
    if (t) out.push(t);
  }
  return out.slice(0, 4);
}
function autosize(ta) { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }
function gatherLetter() {
  return {
    greeting: $("cvGreeting").value.trim(), closing: $("cvClosing").value.trim(), signature: $("cvSignature").value.trim(),
    paragraphs: [...$("cvParas").querySelectorAll("textarea")].map((t) => t.value.trim()).filter(Boolean),
  };
}
function updateWords() {
  const n = wordCount(gatherLetter().paragraphs.join(" "));
  $("cvWords").textContent = state.cover ? `${n} words${n < 250 || n > 400 ? " · aim for 250–400" : ""}` : "No letter yet";
}
function renderLetter() {
  const L = state.cover;
  $("cvEmpty").hidden = !!L; $("cvBody").hidden = !L;
  $("cvExport").disabled = $("bothExport").disabled = !L;
  renderLetterButtons();
  $("cvEvidence").hidden = !(L && L.evidence.length);
  $("cvWarnings").innerHTML = L ? L.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join("") : "";
  if (!L) return updateWords();
  const hdr = contactHeader();
  $("cvHeader").innerHTML = hdr.map((l, i) => `<div class="${i ? "hl-contact" : "hl-name"}">${esc(l)}</div>`).join("");
  const d = new Date();
  $("cvDate").textContent = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  $("cvGreeting").value = L.greeting; $("cvClosing").value = L.closing; $("cvSignature").value = L.signature || hdr[0] || "";
  $("cvParas").innerHTML = "";
  L.paragraphs.forEach((txt, i) => {
    const ta = document.createElement("textarea");
    ta.className = "lt para"; ta.rows = 3; ta.value = txt; ta.setAttribute("aria-label", `Paragraph ${i + 1}`);
    $("cvParas").appendChild(ta);
  });
  requestAnimationFrame(() => $("cvParas").querySelectorAll("textarea").forEach(autosize));
  $("cvEvidenceList").innerHTML = L.evidence.map((e) =>
    `<li><b>${esc(e.jd_requirement)}</b><span class="muted small">Your resume: “${esc(e.resume_evidence)}”</span></li>`).join("");
  updateWords();
}
$("cvPaper").addEventListener("input", (e) => {
  if (e.target.tagName === "TEXTAREA") autosize(e.target);
  state.coverEdited = true; updateWords();
});

function showCover() {
  closePop(); closeGaps(); closeKw();
  $("reviewView").hidden = true; $("coverView").hidden = false;
  const jd = state.analysis.jd;
  $("cvRole").textContent = [jd.role, jd.company].filter((x) => x && x !== "Not specified").join(" · ");
  document.querySelectorAll("#toneSeg button").forEach((b) => b.classList.toggle("active", b.dataset.t === state.tone));
  $("cvFormAcc").open = !state.cover;
  window.scrollTo(0, 0);
  renderLetter(); updateSteps(); refreshFileNames();
  if (!state.cover) $("cvManager").focus();
}
$("toCover").onclick = showCover;
$("coverBack").onclick = () => {
  $("coverView").hidden = true; $("reviewView").hidden = false;
  window.scrollTo(0, 0); updateSteps();
};
document.querySelectorAll("#toneSeg button").forEach((b) => {
  b.onclick = () => { state.tone = b.dataset.t; document.querySelectorAll("#toneSeg button").forEach((x) => x.classList.toggle("active", x === b)); };
});

$("cvGenerate").onclick = async () => {
  if (state.cover && state.coverEdited && !confirm("Regenerating replaces the edits you made to the letter. Continue?")) return;
  const btn = $("cvGenerate");
  btn.disabled = true; $("cvCancel").hidden = false; $("cvCancel").textContent = "Cancel";
  status($("cvStatus"), "Starting…", "info", true);
  try {
    const L = await runJob("/api/jobs/cover_letter", {
      session_id: state.resume.session_id, accepted: acceptedEdits(),
      hiring_manager: $("cvManager").value, tone: state.tone, why_company: $("cvWhy").value,
    }, (job) => {
      coverJob = job;
      const { current, cur, n } = jobProgress(job);
      if (job.status === "running") status($("cvStatus"), `${current ? current.message : "Working"}… (step ${cur + 1} of ${n})`, "info", true);
    });
    state.cover = L; state.coverEdited = false;
    renderLetter(); updateSteps();
    $("cvFormAcc").open = false;  // the letter is the point now; options fold away
    status($("cvStatus"), "", "info");
    toast(`Cover letter ready — ${L.word_count} words${L.warnings.length ? ". Check the notes above it." : ""}`, "ok");
  } catch (e) { status($("cvStatus"), e.cancelled ? "Cancelled." : e.message, e.cancelled ? "info" : "err"); }
  finally { btn.disabled = false; $("cvCancel").hidden = true; renderLetterButtons(); }
};
function renderLetterButtons() { $("cvGenerate").textContent = state.cover ? "Write it again" : "Write cover letter"; }
$("cvCancel").onclick = () => { $("cvCancel").textContent = "Cancelling…"; cancelJob(coverJob); };
$("cvExport").onclick = () => doExport("cover", $("cvExport"), $("cvExportStatus"));
$("bothExport").onclick = () => doExport("both", $("bothExport"), $("cvExportStatus"));

// ------------------------------------------------------------------ settings
function engineChoice() {
  return (document.querySelector('input[name="engine"]:checked') || {}).value || "claude_code";
}
function syncEngineFields() {
  const e = engineChoice();
  $("apiFields").hidden = e !== "api"; $("ccFields").hidden = e !== "claude_code";
}
function openSettings() {
  const cfg = state.cfg;
  const eng = cfg.engine === "auto" ? cfg.active_engine : cfg.engine;
  document.querySelectorAll('input[name="engine"]').forEach((r) => { r.checked = r.value === eng; });
  const cc = $("ccState");
  if (cfg.claude_code_path) { cc.className = "hint ok"; cc.textContent = "Claude Code found on this computer. If it isn't signed in yet, run `claude` in Terminal once and sign in."; }
  else { cc.className = "hint err"; cc.textContent = "Claude Code not found. Install it (see README), run `claude` once to sign in, then restart this app."; }
  $("apiKey").value = "";
  $("keyState").textContent = cfg.has_api_key ? "A key is saved. Leave blank to keep it." : "Get one at platform.claude.com → API keys (billed separately from Claude plans).";
  $("modelIn").value = cfg.model || "";
  $("ccModelIn").value = cfg.cc_model ?? "sonnet";
  $("outDir").value = state.outDir || "";
  $("docFont").value = cfg.doc_font || "EB Garamond";
  $("fileFormat").value = cfg.file_format || "pdf";
  $("nameOverride").value = cfg.name_override || "";
  const ps = $("pdfState");
  ps.className = cfg.pdf_converter ? "hint ok" : "hint err";
  ps.textContent = cfg.pdf_converter
    ? `PDFs are made with ${cfg.pdf_converter === "word" ? "Microsoft Word" : "LibreOffice"}, with EB Garamond embedded.`
    : `${cfg.pdf_missing} Until one is installed, downloads are saved as .docx.`;
  $("boldKw").checked = cfg.bold_keywords !== false;
  $("outDir").placeholder = state.resume ? state.resume.default_output_dir : "Next to your resume";
  syncEngineFields();
  $("settingsDlg").showModal();
}
document.querySelectorAll('input[name="engine"]').forEach((r) => r.addEventListener("change", syncEngineFields));
$("settingsBtn").onclick = openSettings;
$("outBrowse").onclick = async () => {
  try { const { path } = await api("/api/pick", { kind: "folder" }); if (path) $("outDir").value = path; }
  catch (e) { $("keyState").textContent = e.message; }
};
$("saveSettings").onclick = async (e) => {
  e.preventDefault();
  try {
    state.cfg = await api("/api/settings", { engine: engineChoice(), api_key: $("apiKey").value, model: $("modelIn").value,
      cc_model: $("ccModelIn").value, output_dir: $("outDir").value,
      doc_font: $("docFont").value, bold_keywords: $("boldKw").checked, file_format: $("fileFormat").value,
      name_override: $("nameOverride").value });
    state.outDir = state.cfg.output_dir || "";
    applyDocPrefs();
    $("settingsDlg").close();
    toast("Settings saved", "ok");
  } catch (err) { $("keyState").textContent = err.message; }
};

// Document font + bold keywords: the page previews exactly what the .docx will use.
function applyDocPrefs() {
  document.body.classList.toggle("keep-font", state.cfg.doc_font === "keep");
  if (state.analysis && !$("reviewView").hidden) { renderPage(); renderFmtNote(); }
  if (state.analysis) refreshFileNames();
  const f = outFormat(), word = f === "docx" ? ".docx" : "PDF";
  $("exportBtn").textContent = `Download ${word}`;
  $("cvExport").textContent = `Download letter (${word})`;
}
// what Download really saves: the Settings choice, unless PDF was asked for and no converter exists
function outFormat() {
  const f = state.cfg.file_format || "pdf";
  return f !== "docx" && !state.cfg.pdf_converter ? "docx" : f;
}
function renderFmtNote() {
  if (!state.resume) return;
  const fmt = state.resume.keeps_formatting ? "Your Word layout is kept when you download." : "Download builds a clean new .docx (PDF/TXT layout can't be kept).";
  const f = outFormat();
  const out = f === "pdf" ? " Downloads as a PDF with the font embedded." : f === "both" ? " Downloads as a PDF; the .docx is saved next to it." : "";
  const font = state.cfg.doc_font === "keep" || f === "pdf" ? "" :
    ` The .docx is set in EB Garamond: Word shows it only where the font is installed (<a href="https://fonts.google.com/specimen/EB+Garamond" target="_blank" rel="noopener">get it free</a>).`;
  const missing = state.cfg.file_format !== "docx" && !state.cfg.pdf_converter ? ` ${state.cfg.pdf_missing} Saving .docx for now.` : "";
  $("fmtNote").innerHTML = esc(fmt + out) + font + esc(missing) + fileLine("resume");
}

// What Download will call the files, e.g. Yashwanth_Varre_Software_Engineer_Resume.pdf (server-built, so
// the preview and the real name always agree; a _2 suffix is added only if the file already exists).
async function refreshFileNames() {
  if (!state.resume || !state.analysis) return;
  try {
    state.fileNames = await api("/api/file_names", { session_id: state.resume.session_id, accepted: acceptedEdits() });
  } catch (e) { state.fileNames = null; }
  renderFmtNote();
  $("cvFileNote").innerHTML = fileLine("cover");
}
function fileLine(kind) {
  const n = state.fileNames;
  if (!n) return "";
  const f = outFormat(), ext = f === "docx" ? ".docx" : ".pdf";
  const extra = f === "both" ? " (and .docx)" : "";
  const fix = n.name_found ? "" : ` Your name wasn't found on the resume; add it in Settings → “Your name for file names”.`;
  return `<span class="file-line">Saves as <b>${esc(n[kind] + ext)}</b>${extra}.${esc(fix)}</span>`;
}

init().catch((e) => alert("Couldn't reach the Resume Optimizer server: " + e.message));
