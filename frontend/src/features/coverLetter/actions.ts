import type { CoverLetter, ExportResult } from "../../api/types";
import { cancelJob, errMsg, isCancelled, jobProgress, runJob } from "../../lib/jobs";
import { get, set, st, type Status } from "../../store/app";
import { acceptedEdits, contactHeader } from "../../store/derive";
import { toast } from "../../store/toasts";

export function showCover() {
  set((s) => ({ view: "cover", pop: null, sheet: null, menuOpen: false, coverFormOpen: !s.cover }));
  window.scrollTo(0, 0);
}

export function backToReview() {
  set({ view: "review" });
  window.scrollTo(0, 0);
}

export const wordCount = (s: string) => (s.trim().match(/\S+/g) || []).length;

export function gatherLetter() {
  const L = get().letter;
  return {
    greeting: L.greeting.trim(), closing: L.closing.trim(), signature: L.signature.trim(),
    paragraphs: L.paragraphs.map((t) => t.trim()).filter(Boolean),
  };
}

export async function writeCover() {
  const s = get();
  if (!s.resume) return;
  set({ coverStatus: st("Starting…", "info", true) });
  try {
    const L = await runJob<CoverLetter>("/api/jobs/cover_letter", {
      session_id: s.resume.session_id, accepted: acceptedEdits(s), hiring_manager: s.manager, tone: s.tone, why_company: s.why,
    }, (job) => {
      const { current, cur, n } = jobProgress(job);
      set({ coverJob: job });
      if (job.status === "running") set({ coverStatus: st(`${current ? current.message : "Working"}… (step ${cur + 1} of ${n})`, "info", true) });
    });
    const hdr = contactHeader(get());
    set({
      cover: L, coverEdited: false, coverFormOpen: false, coverStatus: st(), // the letter is the point now; options fold away
      letter: { greeting: L.greeting, closing: L.closing, signature: L.signature || hdr[0] || "", paragraphs: [...L.paragraphs] },
    });
    toast(`Cover letter ready — ${L.word_count} words${L.warnings.length ? ". Check the notes above it." : ""}`, "ok");
  } catch (e) {
    set({ coverStatus: isCancelled(e) ? st("Cancelled.") : st(errMsg(e), "err") });
  } finally {
    set({ coverJob: null });
  }
}

export const cancelCover = () => cancelJob(get().coverJob);

// ------------------------------------------------------------------ download
function triggerDownload(d: { download_url: string; file_name: string }) {
  const a = document.createElement("a");
  a.href = d.download_url;
  a.download = d.file_name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** what: "resume" | "cover" | "both" */
export async function doExport(what: "resume" | "cover" | "both") {
  const s = get();
  if (!s.resume || !s.analysis || s.exporting) return;
  const key: "exportStatus" | "cvExportStatus" = what === "resume" ? "exportStatus" : "cvExportStatus";
  const status = (x: Status) => set({ [key]: x } as Partial<typeof s>);
  const jd = s.analysis.jd;
  set({ exporting: what });
  status(st("Preparing your download…", "info", true));
  try {
    const d = await runJob<ExportResult>("/api/jobs/export", {
      session_id: s.resume.session_id, accepted: acceptedEdits(s), output_dir: s.cfg?.output_dir || null,
      company: jd.company || "", role: jd.role || "",
      include_resume: what !== "cover", cover_letter: what === "resume" ? null : gatherLetter(),
      bold_letter_keywords: s.boldLetterKw,
    }, (job) => {
      const { current } = jobProgress(job);
      if (job.status === "running" && current) status(st(current.message + "…", "info", true));
    });
    const file = what === "both" ? d.zip! : what === "cover" ? d.cover! : d;
    const saved = [what !== "cover" && d.files, what !== "resume" && d.cover?.files].filter(Boolean).flat().map((f) => (f as { path: string }).path);
    status(st());
    triggerDownload(file);
    set({ exported: true });
    const name = (p: string) => p.split(/[\\/]/).pop(), folder = (p: string) => p.split(/[\\/]/).slice(-2, -1)[0] || "/";
    if (saved.length) toast(`Saved ${saved.map(name).join(" and ")} in ${folder(saved[0])}`, "ok");
    (d.notices || []).forEach((n) => toast(n, "err"));
    if (what !== "cover" && (d.pages ?? 0) > 1) toast(`Your resume PDF runs to ${d.pages} pages. Skip or tighten an edit if you want one page.`, "info");
  } catch (e) {
    status(isCancelled(e) ? st("Download cancelled.") : st(errMsg(e), "err"));
  } finally {
    set({ exporting: "" });
  }
}
