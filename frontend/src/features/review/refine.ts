import type { RefineResult } from "../../api/types";
import { cancelJob, errMsg, isCancelled, jobProgress, runJob } from "../../lib/jobs";
import { kwRegex } from "../../lib/keywords";
import { get, set, st } from "../../store/app";
import { acceptedEdits, changeText, splitLines } from "../../store/derive";
import { byId, closePop, saveEdit } from "./actions";

/** The edit's lines (a bullet, then any new bullets under it) and its paragraph kind. */
export function refineLines(id: string) {
  const s = get(), c = byId(id), p = c && s.resume?.paragraphs.find((x) => x.id === c.target_id);
  if (!c || !p) return null;
  return { c, lines: splitLines(p.kind, c.original_text, changeText(s, c)), orig: splitLines(p.kind, c.original_text, c.original_text)[0] };
}

export function openRefine(id: string, line: number, anchor: string) {
  if (!byId(id)) return;
  const s = get();
  if (s.refine?.id !== id || s.refine.line !== line) cancelJob(s.refineJob);
  closePop();
  set({ refine: { id, line, anchor }, refineAsk: s.refine?.id === id && s.refine.line === line ? s.refineAsk : "", refineOptions: null, refineStatus: st() });
}

export function closeRefine() {
  const had = get().refine;
  if (!had) return;
  cancelJob(get().refineJob);
  set({ refine: null, refineOptions: null, refineStatus: st() });
  if (document.getElementById("refinePop")?.contains(document.activeElement))
    (document.querySelector(`[data-anchor="${CSS.escape(had.anchor)}"]`) as HTMLElement | null)?.focus();
}

export async function submitRefine() {
  const s = get(), r = s.refine, ask = s.refineAsk.trim(), got = r && refineLines(r.id);
  if (!r || !got || !ask || !s.resume || s.refineJob) return;
  const { c, lines, orig } = got, line = lines[r.line] ?? "";
  // the keywords this edit added that sit in this line: Claude keeps them
  const keywords = (c.jd_keywords || []).filter((t) => kwRegex(t).test(line));
  set({ refineOptions: null, refineStatus: st("Starting…", "info", true) });
  try {
    const d = await runJob<RefineResult>("/api/jobs/refine_change", {
      session_id: s.resume.session_id, target_id: c.target_id, line, original: r.line ? "" : orig, keywords, instruction: ask, accepted: acceptedEdits(s),
    }, (job) => {
      const { current } = jobProgress(job);
      set({ refineJob: job });
      if (job.status === "running" && current) set({ refineStatus: st(`${current.message}…`, "info", true) });
    });
    if (get().refine !== r) return; // closed or moved on while Claude was writing
    set({ refineOptions: d.options, refineStatus: st() });
  } catch (e) {
    if (get().refine === r) set({ refineStatus: isCancelled(e) ? st("Stopped.") : st(errMsg(e), "err") });
  } finally {
    set({ refineJob: null });
  }
}

export const stopRefine = () => cancelJob(get().refineJob);

/** Put the picked rewrite in place of its line; it becomes the user's own edit (Reset brings back Claude's first one). */
export function pickRefine(text: string) {
  const r = get().refine, got = r && refineLines(r.id);
  if (!r || !got) return;
  const lines = [...got.lines];
  lines[r.line] = text;
  saveEdit(got.c, lines.join("\n"), "Rewrite applied");
  closeRefine();
}
