import type { JustifyResult } from "../../api/types";
import { cancelJob, errMsg, isCancelled, jobProgress, runJob } from "../../lib/jobs";
import { get, set, st, type Gap } from "../../store/app";
import { acceptedEdits, defaultGap, gapOf, gapReady, gapTerms, kwForTerm } from "../../store/derive";
import { toast } from "../../store/toasts";
import { closePop, mergeChanges, toggleChange } from "../review/actions";

export const openKeywords = () => set({ sheet: "keywords" });
export const closeSheet = () => set({ sheet: null });

/** Open Add-keywords: all gaps, or with one or more keywords highlighted. */
export function openGaps(terms: string[] = []) {
  closePop();
  set((s) => ({
    sheet: "gaps",
    gapExtra: [...s.gapExtra, ...terms.filter((t) => t && !kwForTerm(s.kws, t) && !s.gapExtra.includes(t))],
    gapFocus: { terms, at: Date.now() },
  }));
}

export function updateGap(term: string, patch: Partial<Gap>) {
  set((s) => ({ gaps: { ...s.gaps, [term]: { ...(s.gaps[term] ?? defaultGap()), ...patch } } }));
}

export function skipAll() {
  const s = get(), terms = gapTerms(s), skip = terms.some((t) => gapOf(s, t).choice !== "skip");
  const gaps = { ...s.gaps };
  terms.forEach((t) => { gaps[t] = { ...gapOf(s, t), choice: skip ? "skip" : "add" }; });
  set({ gaps });
}

export function acceptGapEdit(changeId: string, term: string) {
  toggleChange(changeId, true);
  toast(`Accepted the edit that adds ${term}`, "ok");
}

export async function submitGaps() {
  const s = get();
  const terms = gapTerms(s).filter((t) => gapReady(s, t));
  if (!terms.length || !s.resume) return;
  const items = terms.map((t) => {
    const g = gapOf(s, t);
    return { term: t, mode: g.choice, justification: g.choice === "note" ? g.note.trim() : "", role: g.role };
  });
  set({ gapsStatus: st("Starting…", "info", true) });
  try {
    const d = await runJob<JustifyResult>("/api/jobs/justify_keywords", { session_id: s.resume.session_id, items, accepted: acceptedEdits(s) }, (job) => {
      const { current, cur, n } = jobProgress(job);
      set({ gapsJob: job });
      if (job.status === "running" && current) set({ gapsStatus: st(`${current.message}… (step ${cur + 1} of ${n})`, "info", true) });
    });
    const gaps = { ...get().gaps };
    for (const x of d.decisions) {
      const carrier = d.changes.find((c) => (c.jd_keywords || []).includes(x.term));
      gaps[x.term] = { ...(gaps[x.term] ?? defaultGap()), reply: x, status: carrier ? "added" : "missed", changeId: carrier ? carrier.id : null };
    }
    const added = d.decisions.filter((x) => gaps[x.term].status === "added").length, more = d.decisions.length - added;
    const weak = d.decisions.filter((x) => gaps[x.term].status === "added" && x.evidence === "weak").length;
    const gapsSummary = [added && `Added ${added}`, weak && `${weak} to double-check`, more && `${more} couldn't be placed`].filter(Boolean).join(" · ");
    set({ gaps, gapsSummary, gapsStatus: st() });
    if (d.changes.length) mergeChanges(d.changes);
    toast(gapsSummary, added ? "ok" : "");
  } catch (e) {
    set({ gapsStatus: isCancelled(e) ? st("Stopped.") : st(errMsg(e), "err") });
  } finally {
    set({ gapsJob: null });
  }
}

export const stopGaps = () => cancelJob(get().gapsJob);
