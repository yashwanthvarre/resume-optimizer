"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = { cfg: {}, jdMeta: {}, resume: null, analysis: null, selected: new Set(), edits: {} };

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
  el.className = "status " + kind;
  el.innerHTML = (busy ? '<span class="spinner"></span>' : "") + esc(msg);
}

// ------------------------------------------------------------------ setup
async function init() {
  state.cfg = await api("/api/config");
  const home = state.cfg.home || "~";
  $("resumePath").placeholder = state.cfg.os === "nt" ? `${home}\\Documents\\Resume.docx` : `~/Documents/Resume.docx`;
  if (state.cfg.last_resume_path) $("resumePath").value = state.cfg.last_resume_path;
  const ready = state.cfg.active_engine === "claude_code" ? !!state.cfg.claude_code_path : state.cfg.has_api_key;
  if (!ready) setTimeout(openSettings, 300);
  refreshAnalyze();
}

function refreshAnalyze() {
  $("analyzeBtn").disabled = !(state.resume && $("jdText").value.trim().length > 100);
}

$("fetchBtn").onclick = async () => {
  const url = $("jdUrl").value.trim();
  if (!url) return status($("jdStatus"), "Paste a job link first.", "err");
  $("fetchBtn").disabled = true;
  status($("jdStatus"), "Reading the job posting… (JavaScript-heavy sites can take ~20s)", "info", true);
  try {
    const d = await api("/api/jd/fetch", { url });
    state.jdMeta = d;
    $("jdText").value = d.text;
    $("jdTitle").textContent = [d.title, d.company].filter(Boolean).join(" — ") || "Job description";
    $("jdMethod").textContent = d.method;
    $("jdBox").hidden = false;
    status($("jdStatus"), `Got it — ${d.text.length.toLocaleString()} characters.`, "ok");
  } catch (e) {
    status($("jdStatus"), e.message, "err");
    $("jdBox").hidden = false;
    $("jdTitle").textContent = "Paste the job description";
    $("jdMethod").textContent = "manual";
    $("jdText").focus();
  } finally { $("fetchBtn").disabled = false; refreshAnalyze(); }
};
$("jdUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") $("fetchBtn").click(); });
$("pasteLink").onclick = (e) => {
  e.preventDefault();
  $("jdBox").hidden = false; $("jdTitle").textContent = "Paste the job description"; $("jdMethod").textContent = "manual";
  $("jdText").focus();
};
$("jdText").addEventListener("input", refreshAnalyze);

function onResumeLoaded(d) {
  state.resume = d;
  $("resumePath").value = d.path.includes(".resume-optimizer") ? $("resumePath").value : d.path;
  const fmt = d.keeps_formatting ? "your original formatting will be kept" : "a clean ATS-friendly .docx will be generated (PDF/TXT layout can't be preserved)";
  status($("resumeStatus"), `Loaded ${d.file_name} — ${d.count} paragraphs. On export, ${fmt}.`, "ok");
  refreshAnalyze();
}
$("loadBtn").onclick = async () => {
  status($("resumeStatus"), "Reading resume…", "info", true);
  try { onResumeLoaded(await api("/api/resume/load", { path: $("resumePath").value })); }
  catch (e) { state.resume = null; status($("resumeStatus"), e.message, "err"); refreshAnalyze(); }
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
$("uploadInput").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const fd = new FormData(); fd.append("file", f);
  status($("resumeStatus"), "Uploading…", "info", true);
  try { onResumeLoaded(await api("/api/resume/upload", fd, true)); }
  catch (err) { status($("resumeStatus"), err.message, "err"); }
  e.target.value = "";
};

$("analyzeBtn").onclick = async () => {
  $("analyzeBtn").disabled = true;
  status($("analyzeStatus"), "Analyzing the job and your resume… this usually takes 1–3 minutes.", "info", true);
  try {
    const d = await api("/api/analyze", { session_id: state.resume.session_id, jd_text: $("jdText").value });
    state.analysis = d;
    state.selected = new Set(d.changes.map((c) => c.id));
    state.edits = {};
    status($("analyzeStatus"), "", "info");
    showReview();
  } catch (e) { status($("analyzeStatus"), e.message, "err"); }
  finally { refreshAnalyze(); }
};

// ------------------------------------------------------------------ keywords & score
function kwRegex(term) {
  const t = term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+");
  return new RegExp(`(^|[^A-Za-z0-9])${t}(?:s|es)?(?=$|[^A-Za-z0-9])`, "i");
}
const WEIGHT = { required: 3, preferred: 2, nice: 1 };
function prepKeywords() {
  state.kws = (state.analysis.jd.keywords || []).map((k) => ({
    ...k, w: WEIGHT[k.importance] || 1,
    res: [k.term, ...(k.variants || [])].filter(Boolean).map(kwRegex),
  }));
}
function coverage(text) {
  let tot = 0, got = 0; const hit = new Set();
  for (const k of state.kws) { tot += k.w; if (k.res.some((r) => r.test(text))) { got += k.w; hit.add(k.term); } }
  return { score: tot ? Math.round((100 * got) / tot) : 0, hit };
}
function currentText(id) {
  const c = state.analysis.changes.find((x) => x.target_id === id && state.selected.has(x.id));
  return c ? state.edits[c.id] ?? c.new_text : null;
}
function fullText(applied) {
  return state.resume.paragraphs.map((p) => (applied ? currentText(p.id) ?? p.text : p.text)).join("\n");
}

// ------------------------------------------------------------------ word diff
function diffWords(a, b) {
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
  return out.map((o) => o.t === "=" ? esc(o.s) : o.t === "-" ? `<del>${esc(o.s)}</del>` : `<ins>${esc(o.s)}</ins>`).join("");
}

// ------------------------------------------------------------------ review rendering
function showReview() {
  $("setupView").hidden = true; $("reviewView").hidden = false; $("restartBtn").hidden = false;
  const jd = state.analysis.jd;
  $("rvRole").textContent = [jd.role, jd.company].filter(Boolean).join(" · ");
  $("rvAssessment").textContent = state.analysis.overall_assessment || jd.summary || "";
  $("outDir").value = state.resume.default_output_dir;
  $("fmtNote").textContent = state.resume.keeps_formatting ? "· text only; your Word formatting is kept on export" : "· export builds a clean new .docx";
  prepKeywords();
  $("scoreBefore").textContent = coverage(fullText(false)).score;
  renderChanges(); renderSuggestions(); update();
  window.scrollTo(0, 0);
}

const TYPE_LABEL = { reword: "Reworded", keyword: "Keyword", quantify: "Impact", reorder: "Reordered", tighten: "Tightened", summary: "Summary" };

function renderChanges() {
  const list = $("changeList"); list.innerHTML = "";
  if (!state.analysis.changes.length) {
    list.innerHTML = '<div class="card muted">No changes were needed — your resume already matches this job well.</div>';
    return;
  }
  let lastSection = null;
  for (const c of state.analysis.changes) {
    if (c.section !== lastSection) {
      lastSection = c.section;
      const h = document.createElement("div"); h.className = "section-label"; h.textContent = c.section; list.appendChild(h);
    }
    const el = document.createElement("div");
    el.className = "chg"; el.id = "card-" + c.id;
    el.innerHTML = `
      <button class="tick" aria-label="Include this change" title="Include / exclude this change">✓</button>
      <div>
        <div class="chg-head"><span class="type">${esc(TYPE_LABEL[c.type] || c.type)}</span>
          <span class="where" data-target="${c.target_id}">Show in preview ↗</span><span class="edited-tag" hidden>· edited by you</span></div>
        <div class="diff"></div>
        <div class="reason">${esc(c.reason)} ${(c.jd_keywords || []).map((k) => `<span class="chip added">${esc(k)}</span>`).join("")}</div>
        ${(c.warnings || []).map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("")}
        <div class="chg-actions"><button class="ghost edit-btn">✎ Edit text</button></div>
        <div class="editor" hidden><textarea rows="3"></textarea>
          <div class="chg-actions"><button class="secondary save-edit">Apply edit</button> <button class="ghost reset-edit">Reset to suggestion</button></div></div>
      </div>`;
    const tick = el.querySelector(".tick");
    tick.onclick = () => { state.selected.has(c.id) ? state.selected.delete(c.id) : state.selected.add(c.id); update(); };
    el.querySelector(".where").onclick = () => flash(c.target_id);
    const editor = el.querySelector(".editor"), ta = editor.querySelector("textarea");
    el.querySelector(".edit-btn").onclick = () => { editor.hidden = !editor.hidden; ta.value = state.edits[c.id] ?? c.new_text; ta.focus(); };
    editor.querySelector(".save-edit").onclick = () => {
      const v = ta.value.trim();
      if (v && v !== c.new_text) state.edits[c.id] = v; else delete state.edits[c.id];
      state.selected.add(c.id); editor.hidden = true; update();
    };
    editor.querySelector(".reset-edit").onclick = () => { delete state.edits[c.id]; ta.value = c.new_text; update(); };
    list.appendChild(el);
  }
}

function renderSuggestions() {
  const s = state.analysis.suggestions || [];
  $("suggestBox").hidden = !s.length;
  $("suggestList").innerHTML = s.map((x) => `<li><b>${esc(x.text)}</b><br><span class="muted small">${esc(x.reason)}</span></li>`).join("");
}

function update() {
  const changes = state.analysis.changes;
  for (const c of changes) {
    const el = $("card-" + c.id), on = state.selected.has(c.id), txt = state.edits[c.id] ?? c.new_text;
    el.classList.toggle("on", on); el.classList.toggle("off", !on);
    el.querySelector(".diff").innerHTML = diffWords(c.original_text, txt);
    el.querySelector(".edited-tag").hidden = !(c.id in state.edits);
  }
  $("selCount").textContent = `${state.selected.size} of ${changes.length} changes selected`;
  $("exportBtn").textContent = `Download updated resume (.docx)`;

  // preview
  const prev = $("preview"); prev.innerHTML = "";
  let first = true;
  for (const p of state.resume.paragraphs) {
    const cur = currentText(p.id);
    const d = document.createElement("div");
    d.className = `pp ${p.kind}` + (cur !== null ? " changed" : "") + (first && p.text.trim() ? " first" : "");
    if (p.text.trim()) first = false;
    d.id = "pp-" + p.id;
    d.textContent = (cur ?? p.text).replace(/\t+/g, "   ");
    prev.appendChild(d);
  }
  prev.classList.toggle("hl", $("hlToggle").checked);

  // score + keyword chips
  const before = coverage(fullText(false)), after = coverage(fullText(true));
  $("scoreAfter").textContent = after.score;
  const kws = [...state.kws].sort((a, b) => b.w - a.w);
  $("kwChips").innerHTML = kws.map((k) => {
    const cls = before.hit.has(k.term) ? "ok" : after.hit.has(k.term) ? "added" : "miss";
    return `<span class="chip ${cls}${k.importance === "required" ? " req" : ""}" title="${esc(k.importance)}">${esc(k.term)}</span>`;
  }).join("");
  $("kwCount").textContent = `· ${after.hit.size} of ${kws.length} covered`;
}

function flash(pid) {
  const el = $("pp-" + pid); if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1200);
}

$("selAll").onclick = () => { state.selected = new Set(state.analysis.changes.map((c) => c.id)); update(); };
$("selNone").onclick = () => { state.selected.clear(); update(); };
$("hlToggle").onchange = update;
$("restartBtn").onclick = () => {
  $("reviewView").hidden = true; $("setupView").hidden = false; $("restartBtn").hidden = true;
  $("jdUrl").value = ""; $("jdText").value = ""; $("jdBox").hidden = true; status($("jdStatus"), "", "info");
  refreshAnalyze();
};

$("outBrowse").onclick = async () => {
  status($("exportStatus"), "A folder picker opened on your computer…", "info", true);
  try { const { path } = await api("/api/pick", { kind: "folder" }); if (path) $("outDir").value = path; status($("exportStatus"), "", "info"); }
  catch (e) { status($("exportStatus"), e.message, "err"); }
};

$("exportBtn").onclick = async () => {
  const accepted = state.analysis.changes.filter((c) => state.selected.has(c.id))
    .map((c) => ({ target_id: c.target_id, new_text: state.edits[c.id] ?? c.new_text }));
  $("exportBtn").disabled = true;
  status($("exportStatus"), "Building your .docx…", "info", true);
  try {
    const jd = state.analysis.jd;
    const d = await api("/api/export", { session_id: state.resume.session_id, accepted, output_dir: $("outDir").value, company: jd.company || "", role: jd.role || "" });
    status($("exportStatus"), `Saved ${d.applied} change(s) to ${d.path}`, "ok");
    const a = document.createElement("a"); a.href = d.download_url; a.download = d.file_name; document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { status($("exportStatus"), e.message, "err"); }
  finally { $("exportBtn").disabled = false; }
};

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
  if (cfg.claude_code_path) { cc.className = "hint ok"; cc.textContent = "✓ Claude Code found on this computer. If it isn't signed in yet, run `claude` in Terminal once and sign in."; }
  else { cc.className = "hint err"; cc.textContent = "Claude Code not found. Install it (see README), run `claude` once to sign in, then restart this app."; }
  $("apiKey").value = "";
  $("keyState").textContent = cfg.has_api_key ? "A key is saved. Leave blank to keep it." : "Get one at platform.claude.com → API keys (billed separately from Claude plans).";
  $("modelIn").value = cfg.model || "";
  $("ccModelIn").value = cfg.cc_model ?? "sonnet";
  syncEngineFields();
  $("settingsDlg").showModal();
}
document.querySelectorAll('input[name="engine"]').forEach((r) => r.addEventListener("change", syncEngineFields));
$("settingsBtn").onclick = openSettings;
$("saveSettings").onclick = async (e) => {
  e.preventDefault();
  try {
    state.cfg = await api("/api/settings", { engine: engineChoice(), api_key: $("apiKey").value, model: $("modelIn").value, cc_model: $("ccModelIn").value });
    $("settingsDlg").close();
  } catch (err) { $("keyState").textContent = err.message; }
};

init().catch((e) => alert("Couldn't reach the Resume Optimizer server: " + e.message));
