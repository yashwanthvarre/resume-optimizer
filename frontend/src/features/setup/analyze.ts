import type { Analysis } from "../../api/types";
import { cancelJob, errMsg, isCancelled, runJob } from "../../lib/jobs";
import { prepKeywords } from "../../lib/keywords";
import { emptyLetter, get, set, st } from "../../store/app";
import { showReview } from "../review/actions";

export async function analyze() {
  const s = get();
  if (!s.resume || s.analyzing) return;
  set({ analyzing: true, analyzeJob: null, progressShown: true, analyzeStatus: st() });
  try {
    const d = await runJob<Analysis>("/api/jobs/analyze", { session_id: s.resume.session_id, jd_text: s.jdText }, (job) => set({ analyzeJob: job }));
    const { kws, all } = prepKeywords(d.jd.keywords);
    set({
      analysis: d, kws, kwAll: all,
      selected: new Set(d.changes.map((c) => c.id)), edits: {}, filter: "all", kwFilter: null, pop: null, editorOpen: false, exported: false,
      cover: null, letter: emptyLetter, coverEdited: false, coverFormOpen: true,
      gaps: {}, gapExtra: [], gapsSummary: "", noticeOpen: true,
    });
    // let the finished bar land before the page changes
    await new Promise((r) => setTimeout(r, 350));
    set({ progressShown: false, analyzing: false });
    showReview();
  } catch (e) {
    set({ progressShown: false, analyzing: false, analyzeStatus: isCancelled(e) ? st("Analysis cancelled.") : st(errMsg(e), "err") });
  }
}

export const cancelAnalyze = () => cancelJob(get().analyzeJob);
