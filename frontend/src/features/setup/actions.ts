// Setup flows: loading the resume, fetching the posting, the job finder, and a tab opened from the job list.
import { api, getConfig, saveSettings } from "../../api/client";
import type { FindResult, JdMeta, Resume } from "../../api/types";
import { cancelJob, errMsg, isCancelled, jobProgress, logLocal, runJob } from "../../lib/jobs";
import { get, set, st } from "../../store/app";
import { resumeKey } from "../../store/derive";
import { toast } from "../../store/toasts";
import { analyze } from "./analyze";

const BASE_TITLE = "Resume Optimizer";
export const setTabTitle = (label: string) => { document.title = label ? `${label} · ${BASE_TITLE}` : BASE_TITLE; };

export async function init() {
  const cfg = await getConfig();
  set({ cfg, resumePath: cfg.last_resume_path || "" });
  const ready = cfg.active_engine === "claude_code" ? !!cfg.claude_code_path : cfg.has_api_key;
  if (!ready) setTimeout(() => set({ settingsOpen: true }), 300);
  const q = new URLSearchParams(location.search);
  if (q.get("job")) await openFromFinder(q);
  else if (cfg.default_resume_path) await loadResumePath(cfg.default_resume_path);
}

// ------------------------------------------------------------------ resume
function onResumeLoaded(d: Resume) {
  set((s) => ({
    resume: d,
    resumeIsDefault: !!s.cfg?.default_resume_path && d.path === s.cfg.default_resume_path,
    resumePath: d.path.includes(".resume-optimizer") ? s.resumePath : d.path,
    resumeStatus: st(`${d.count} paragraphs found. ${d.keeps_formatting ? "Your formatting is kept when you download." : "PDF/TXT layout can't be kept, so you'll get a clean new .docx."}`, "ok"),
  }));
  logLocal("Load resume", [
    { step: "read", label: "Read your resume", message: `Read ${d.file_name}` },
    { step: "parse", label: "Find paragraphs & sections", message: `Found ${d.count} paragraphs in ${d.sections} section${d.sections === 1 ? "" : "s"}`,
      detail: [...new Set(d.paragraphs.filter((x) => x.kind === "heading").map((x) => x.text.trim()))] },
  ]);
  autoFind();
}

function onResumeFailed(msg: string) {
  set({ resume: null, resumeIsDefault: false, resumeStatus: st(msg, "err") });
  logLocal("Load resume", [{ step: "read", label: "Read your resume", message: msg, status: "error" }], "error", msg);
}

/** Loads the path in the box, or `path` (the default resume) without touching what's typed there. */
export async function loadResumePath(path = get().resumePath) {
  set({ resumeStatus: st("Reading resume…", "info", true) });
  try { onResumeLoaded(await api<Resume>("/api/resume/load", { path })); }
  catch (e) { onResumeFailed(errMsg(e)); }
}

/** Back to default: swaps the session-only resume for the one set in Settings. */
export function loadDefaultResume() {
  const path = get().cfg?.default_resume_path;
  if (path) void loadResumePath(path);
}

/** Make this my default: the loaded resume is loaded on every start from now on. */
export async function makeDefaultResume() {
  const r = get().resume;
  if (!r) return;
  try {
    const cfg = await saveSettings({ default_resume_path: r.path });
    set({ cfg, resumeIsDefault: true });
    toast(`${r.file_name} is now your default resume`, "ok");
  } catch (e) { toast(errMsg(e), "err"); }
}

export async function browseResume() {
  set({ resumeStatus: st("A file picker opened on your computer (it may be behind this window)…", "info", true) });
  try {
    const { path } = await api<{ path: string }>("/api/pick", { kind: "file" });
    if (!path) return set({ resumeStatus: st("No file chosen.") });
    set({ resumePath: path });
    await loadResumePath();
  } catch (e) { set({ resumeStatus: st(errMsg(e), "err") }); }
}

export async function uploadResume(f: File) {
  if (!/\.(docx|pdf|txt|md)$/i.test(f.name)) return onResumeFailed(`${f.name} isn't supported — use .docx, .pdf or .txt.`);
  const fd = new FormData();
  fd.append("file", f);
  set({ resumeStatus: st(`Uploading ${f.name}…`, "info", true) });
  try { onResumeLoaded(await api<Resume>("/api/resume/upload", fd)); }
  catch (e) { onResumeFailed(errMsg(e)); }
}

// ------------------------------------------------------------------ the job posting
// The posting is fetched as soon as a link is in the box: on paste, ~600ms after typing stops, on leaving the field
// or on Enter. The same URL is never fetched twice (Retry forces it); a new URL cancels the fetch in flight.
let fetchSeq = 0, fetchTimer = 0, fetchedUrl = "";
let fetchJob: Parameters<typeof cancelJob>[0] = null;
const looksLikeUrl = (u: string) => /^https?:\/\/[^\s/]+\.[^\s/]{2,}(\/\S*)?$/i.test(u);

export function scheduleFetch(ms = 600) {
  clearTimeout(fetchTimer);
  fetchTimer = window.setTimeout(() => void fetchJd(), ms);
}

export async function fetchJd(force = false) {
  clearTimeout(fetchTimer);
  const url = get().jdUrl.trim();
  if (!url || !looksLikeUrl(url)) {
    if (force) set({ jdStatus: st(url ? "That doesn't look like a web link (it should start with https://)." : "Paste a job link first.", "err") });
    return;
  }
  if (!force && url === fetchedUrl) return;
  cancelJob(fetchJob);
  const seq = ++fetchSeq;
  fetchedUrl = url;
  set({ fetching: true, fetchRetry: false, jdStatus: st("Fetching posting…", "info", true) });
  try {
    const d = await runJob<JdMeta>("/api/jobs/jd_fetch", { url }, (job) => {
      if (seq !== fetchSeq) return cancelJob(job); // a newer link replaced this one
      fetchJob = job;
      const { current } = jobProgress(job);
      if (job.status === "running") set({ jdStatus: st(`Fetching posting… ${current ? current.message : ""}`, "info", true) });
    });
    if (seq !== fetchSeq) return;
    set({
      jdMeta: d, jdText: d.text, jdBox: true, jdMethod: d.method || "",
      jdTitle: [d.title, d.company].filter(Boolean).join(" — ") || "Job description",
      jdStatus: st(`Got it — ${d.text.length.toLocaleString()} characters.`, "ok"),
    });
  } catch (e) {
    if (seq !== fetchSeq || isCancelled(e)) return;
    set({ jdStatus: st(errMsg(e), "err"), fetchRetry: true, jdBox: true, jdTitle: "Paste the job description", jdMethod: "manual" });
  } finally {
    if (seq === fetchSeq) { fetchJob = null; set({ fetching: false }); }
  }
}

export function showPasteBox() {
  set({ jdBox: true, jdTitle: "Paste the job description", jdMethod: "manual" });
}

/** Forget the posting (New job): cancels any fetch in flight. */
export function resetJob() {
  fetchSeq++;
  cancelJob(fetchJob);
  fetchJob = null;
  fetchedUrl = "";
  clearTimeout(fetchTimer);
  set({ jdUrl: "", jdText: "", jdMeta: {}, jdBox: false, jdStatus: st(), fetching: false, fetchRetry: false });
}

// ------------------------------------------------------------------ find fresh jobs
// Claude searches the web for postings that fit the loaded resume and are under 2 hours old. The search starts by
// itself once a resume is loaded (not in tabs opened from the list); "Search again" re-runs it. Each job opens in a new
// tab (/?job=…&from=<session>) that clones the resume into its own server session, fetches the posting and starts the
// usual analysis, so every job keeps its own edits, cover letter and file names.

/** Runs once per distinct resume: reloading the same file doesn't search again, and a resume swapped in mid-search
 *  is searched for when the current search ends. */
export function autoFind() {
  const s = get();
  if (s.finderTab || !s.resume || s.findRunning || resumeKey(s) === s.searchedFor) return;
  void findJobs();
}

export async function findJobs() {
  const s = get();
  if (!s.resume) return;
  set({ findRunning: true, findJob: null, searchedFor: resumeKey(s), found: null,
    findStatus: st("Claude is searching job boards. This can take a few minutes.", "info", true) });
  try {
    const d = await runJob<FindResult>("/api/jobs/find_jobs", { session_id: s.resume.session_id }, (job) => {
      const { current } = jobProgress(job);
      set({ findJob: job });
      if (job.status === "running" && current) set({ findStatus: st(current.message + "…", "info", true) });
    });
    const n = d.jobs.length;
    const left = d.dropped.length ? ` ${d.dropped.length} older or unverifiable posting${d.dropped.length === 1 ? " was" : "s were"} left out.` : "";
    set({
      found: n ? d : null, foundAt: Date.now(), opened: [],
      findStatus: n
        ? st(`Found ${n} job${n === 1 ? "" : "s"} posted in the last 2 hours${n < 5 ? " (fewer than 5 qualified)" : ""}.${left}`, "ok")
        : st(`No postings from the last 2 hours matched your resume.${left} Try again a little later.`),
    });
  } catch (e) {
    set({ findStatus: isCancelled(e) ? st("Search cancelled.") : st(errMsg(e), "err") });
  } finally {
    set({ findRunning: false, findJob: null, hasSearched: true });
    autoFind();
  }
}

export function openJob(i: number) {
  const s = get(), j = s.found?.jobs[i];
  if (!j || !s.resume) return false;
  const q = new URLSearchParams({ job: j.url, from: s.resume.session_id, title: j.title, company: j.company });
  const w = window.open(`${location.pathname}?${q}`, "_blank");
  if (!w) return false;
  w.opener = null;
  set((x) => ({ opened: x.opened.includes(i) ? x.opened : [...x.opened, i] }));
  return true;
}

export function openOneJob(i: number) {
  if (!openJob(i)) toast("Your browser blocked the new tab. Allow pop-ups for this page and try again.", "err");
}

export function tailorAll() {
  const blocked = (get().found?.jobs || []).filter((_, i) => !openJob(i)).length;
  if (blocked) toast(`${blocked} tab${blocked === 1 ? " was" : "s were"} blocked. Allow pop-ups for this page, or open them one at a time.`, "err");
}

/** A tab opened from the list: same resume (fresh session), this job's posting, then straight into Analyze. */
async function openFromFinder(q: URLSearchParams) {
  setTabTitle([q.get("company"), q.get("title")].filter(Boolean).join(" – "));
  history.replaceState(null, "", location.pathname); // a reload starts clean instead of re-running
  set({ finderTab: true, jdUrl: q.get("job") || "" });
  const resume = (async () => {
    const from = q.get("from");
    if (!from) return;
    set({ resumeStatus: st("Loading your resume…", "info", true) });
    try { onResumeLoaded(await api<Resume>("/api/resume/clone", { session_id: from })); }
    catch (e) { onResumeFailed(`${errMsg(e)} Then click Analyze.`); }
  })();
  await Promise.all([fetchJd(true), resume]);
  const s = get();
  if (s.resume && s.jdText.trim().length > 100) await analyze();
  else if (s.resume) set({ analyzeStatus: st("Couldn't read this posting automatically. Paste the job description above, then click Analyze.") });
}
