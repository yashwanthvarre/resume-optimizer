import type { Change } from "../../api/types";
import { get, set, type DiffMode, type Filter } from "../../store/app";
import { fullText, kwForTerm, matchesFilter, tabLabel, visibleEdits } from "../../store/derive";
import { toast } from "../../store/toasts";
import { resetJob, setTabTitle } from "../setup/actions";

export const byId = (id: string | null) => (id ? get().analysis?.changes.find((c) => c.id === id) : undefined);

export function showReview() {
  set({ view: "review", filter: "all", kwFilter: null, pop: null, menuOpen: false });
  setTabTitle(tabLabel(get()));
  window.scrollTo(0, 0);
}

export const scrollToChange = (id: string) =>
  requestAnimationFrame(() => document.querySelector(`[data-change="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));

export function openPop(id: string) {
  if (!byId(id)) return;
  set({ pop: id, editorOpen: false });
  scrollToChange(id);
}

export function closePop() {
  const had = get().pop;
  if (!had) return;
  set({ pop: null, editorOpen: false });
  // hand focus back to the paragraph if it was inside the popover
  if (document.getElementById("editPop")?.contains(document.activeElement))
    (document.querySelector(`[data-change="${CSS.escape(had)}"]`) as HTMLElement | null)?.focus();
}

export function stepPop(dir: number) {
  const s = get(), list = visibleEdits(s);
  if (!list.length) return;
  const at = list.findIndex((x) => x.id === s.pop);
  const next = at < 0 ? (dir > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, at + dir));
  openPop(list[next].id);
}

export function toggleChange(id: string, on?: boolean) {
  set((s) => {
    const selected = new Set(s.selected);
    const want = on ?? !selected.has(id);
    if (want) selected.add(id); else selected.delete(id);
    return { selected };
  });
}

export function saveEdit(c: Change, value: string) {
  const v = value.trim();
  set((s) => {
    const edits = { ...s.edits };
    if (v && v !== c.new_text) edits[c.id] = v; else delete edits[c.id];
    return { edits, selected: new Set(s.selected).add(c.id), editorOpen: false };
  });
  toast("Edit saved", "ok");
}

export function resetEdit(c: Change) {
  set((s) => {
    const edits = { ...s.edits };
    delete edits[c.id];
    return { edits };
  });
}

export function setFilter(f: Filter) {
  set({ filter: f });
  closePop();
}

export function setKwFilter(term: string | null) {
  closePop();
  set({ kwFilter: term });
  if (!term) return;
  const s = get(), list = visibleEdits(s);
  if (list.length) scrollToChange(list[0].id);
  else {
    const k = kwForTerm(s.kws, term), inResume = k && k.res.some((r) => r.test(fullText(s, false)));
    toast(inResume ? `“${term}” was already in your resume.` : `No edit adds “${term}”.`);
  }
}

export function selectAll(on: boolean) {
  set((s) => ({ selected: on ? new Set(s.analysis!.changes.map((c) => c.id)) : new Set(), menuOpen: false }));
  toast(on ? "All edits accepted" : "All edits skipped");
}

export function setDiffMode(m: DiffMode) {
  try { localStorage.setItem("ro.diffMode", m); } catch { /* storage blocked */ }
  set({ diffMode: m });
}

/** Show an edit even if the current filter hides it. */
export function focusEdit(id: string) {
  const s = get(), c = byId(id);
  if (!c) return;
  if (!matchesFilter(s, c)) set({ filter: "all", kwFilter: null });
  openPop(id);
}

/** New edits replace any existing edit on the same paragraph (they already build on its text). */
export function mergeChanges(newChanges: Change[]) {
  set((s) => {
    const analysis = s.analysis!, targets = new Set(newChanges.map((c) => c.target_id));
    const selected = new Set(s.selected), edits = { ...s.edits };
    let pop = s.pop;
    for (const old of analysis.changes.filter((c) => targets.has(c.target_id))) {
      selected.delete(old.id);
      delete edits[old.id];
      if (pop === old.id) pop = null;
    }
    const pos = Object.fromEntries(s.resume!.paragraphs.map((p, n) => [p.id, n])); // reading order
    const changes = analysis.changes.filter((c) => !targets.has(c.target_id)).concat(newChanges)
      .sort((a, b) => (pos[a.target_id] ?? 0) - (pos[b.target_id] ?? 0));
    newChanges.forEach((c) => selected.add(c.id)); // keyword edits go straight in; the user can still skip any of them
    return { analysis: { ...analysis, changes }, selected, edits, pop, filter: "all", kwFilter: null,
      addedNow: { ids: newChanges.map((c) => c.id), at: Date.now() } };
  });
}

export function restart() {
  resetJob();
  set({
    view: "setup", pop: null, sheet: null, menuOpen: false,
    gaps: {}, gapExtra: [], gapsSummary: "", cover: null, coverEdited: false, manager: "", why: "", coverStatus: { msg: "", kind: "info" },
    exported: false, analyzeStatus: { msg: "", kind: "info" },
  });
  setTabTitle("");
  window.scrollTo(0, 0);
}
