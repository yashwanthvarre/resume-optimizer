import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useState } from "react";
import type { Change } from "../../api/types";
import { useAutosize } from "../../hooks/useAutosize";
import { SHEET_QUERY, useMedia } from "../../hooks/useMedia";
import { diffOps, diffView, heavy } from "../../lib/diff";
import { set, useApp, type DiffMode } from "../../store/app";
import { changeText, visibleEdits } from "../../store/derive";
import { byId, closePop, resetEdit, saveEdit, stepPop, toggleChange } from "./actions";

const TYPE_LABEL: Record<string, string> = { reword: "Reworded", keyword: "Keyword", quantify: "Impact", reorder: "Reordered", tighten: "Tightened", summary: "Summary" };

function Diff({ a, b, mode }: { a: string; b: string; mode: DiffMode }) {
  const ops = diffOps(a, b);
  const stacked = mode === "stacked" || (mode === "auto" && heavy(ops, a, b));
  if (!stacked)
    return <div className="diff">{ops.map((o, i) => (o.t === "=" ? o.s : o.t === "-" ? <del key={i}>{o.s}</del> : <ins key={i}>{o.s}</ins>))}</div>;
  const row = (lbl: string, drop: "+" | "-") => (
    <div className="grid grid-cols-1 items-baseline gap-0.5 rounded-ctl bg-canvas px-2.5 py-2 sm:grid-cols-[52px_minmax(0,1fr)] sm:gap-2.5">
      <span className="text-[11px] font-semibold tracking-[.05em] text-ink-3 uppercase">{lbl}</span>
      <div className="diff">{diffView(ops, drop).map((o, i) => (o.t === "=" ? o.s : o.t === "-" ? <del key={i}>{o.s}</del> : <ins key={i}>{o.s}</ins>))}</div>
    </div>
  );
  return <div className="grid gap-1.5">{row("Before", "+")}{row("After", "-")}</div>;
}

function Editor({ c }: { c: Change }) {
  const edits = useApp((s) => s.edits);
  const [v, setV] = useState(edits[c.id] ?? c.new_text);
  const ref = useAutosize(v);
  useEffect(() => {
    const ta = ref.current;
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }, [ref]);
  return (
    <motion.div className="grid gap-2 overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
      <textarea ref={ref} id="popText" className="field min-h-20 resize-none overflow-hidden" rows={4} aria-label="Edit this paragraph" value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveEdit(c, v);
          if (e.key === "Escape") { e.stopPropagation(); set({ editorOpen: false }); }
        }} />
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className="btn sm pop-save" onClick={() => saveEdit(c, v)}>Save edit</button>
        <button type="button" className="btn ghost sm" onClick={() => set({ editorOpen: false })}>Cancel</button>
      </div>
    </motion.div>
  );
}

/** Where the popover sits: just under its paragraph, inside the page's width (document coordinates). */
function usePosition(id: string | null, sheet: boolean) {
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!id || sheet) return;
    const place = () => {
      const el = document.querySelector(`[data-change="${CSS.escape(id)}"]`), page = document.getElementById("preview");
      if (!el || !page) return;
      const r = el.getBoundingClientRect(), pr = page.getBoundingClientRect(), w = Math.min(480, pr.width - 16);
      const next = { width: w, left: Math.max(8, Math.min(r.left, pr.right - w - 8)) + scrollX, top: r.bottom + scrollY + 8 };
      setPos((p) => (p && p.width === next.width && p.left === next.left && p.top === next.top ? p : next));
    };
    place();
    addEventListener("resize", place);
    return () => removeEventListener("resize", place);
  });
  return pos;
}

export function EditPopover() {
  const s = useApp();
  const sheet = useMedia(SHEET_QUERY);
  const c = s.view === "review" ? byId(s.pop) : undefined;
  const pos = usePosition(c?.id ?? null, sheet);

  // a click anywhere else closes it
  useEffect(() => {
    if (!c) return;
    const down = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.("#editPop, .edit, #moreMenu, .sheet, [role=dialog], .toasts")) closePop();
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [c]);

  const show = !!c && (sheet || !!pos);
  return (
    <AnimatePresence>
      {show && c && (
        <motion.div key="pop" id="editPop" role="dialog" aria-labelledby="popTitle"
          className="floating no-print z-25 grid gap-2.5 rounded-card border border-line bg-paper px-4 pt-3.5 pb-3 text-sm shadow-2"
          style={sheet ? undefined : { width: pos!.width }}
          initial={sheet ? { y: "100%" } : { opacity: 0, scale: 0.96, left: pos!.left, top: pos!.top - 6 }}
          animate={sheet ? { y: 0 } : { opacity: 1, scale: 1, left: pos!.left, top: pos!.top }}
          exit={sheet ? { y: "100%" } : { opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
          transition={{ type: "spring", stiffness: 520, damping: 40 }}>
          <PopBody c={c} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PopBody({ c }: { c: Change }) {
  const s = useApp();
  const on = s.selected.has(c.id), cur = changeText(s, c), edited = c.id in s.edits;
  const list = visibleEdits(s), at = list.findIndex((x) => x.id === c.id);
  const type = TYPE_LABEL[c.type] || c.type, sec = c.section.toLowerCase() === String(type).toLowerCase() ? c.section : `${c.section} · ${type}`;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-auto text-xs font-semibold tracking-[.04em] text-ink-3 uppercase">{sec}</span>
        {c.source === "add" ? <span className="tag lilac" title={`Claude added ${c.from_input} from work your resume already shows. Skip it if it isn't accurate`}>Added by Claude</span>
          : c.from_input ? <span className="tag sky" title={`Added from what you told Claude about ${c.from_input}`}>From your input</span> : null}
        {edited && <span className="tag">Edited by you</span>}
        <span className="ml-1.5 inline-flex items-center gap-0.5">
          <button type="button" className="btn ghost icon sm" aria-label="Previous edit" disabled={at <= 0} onClick={() => stepPop(-1)}>‹</button>
          <span className="muted small tabular-nums">{at >= 0 ? at + 1 : "–"} of {list.length}</span>
          <button type="button" className="btn ghost icon sm" aria-label="Next edit" disabled={at < 0 || at >= list.length - 1} onClick={() => stepPop(1)}>›</button>
        </span>
        <button type="button" className="btn ghost icon sm" aria-label="Close" onClick={closePop}>✕</button>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={c.id} className="grid gap-2.5" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}>
          <p className="font-medium text-ink" id="popTitle">{c.reason}</p>
          <Diff a={c.original_text} b={cur} mode={s.diffMode} />
          {(c.jd_keywords || []).length > 0 && <div className="flex flex-wrap gap-1.5">{c.jd_keywords!.map((k) => <span key={k} className="tag sky">{k}</span>)}</div>}
          {(c.warnings || []).map((w) => <div key={w} className="warn !m-0">{w}</div>)}
        </motion.div>
      </AnimatePresence>
      <AnimatePresence>{s.editorOpen && <Editor key={c.id} c={c} />}</AnimatePresence>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
        <motion.button type="button" whileTap={{ scale: 0.94 }} className={`btn ${on ? "" : "secondary"} pop-accept`} aria-pressed={on} onClick={() => toggleChange(c.id, true)}>
          {on ? "✓ Accepted" : "Accept"}
        </motion.button>
        <motion.button type="button" whileTap={{ scale: 0.94 }} className={`btn ${on ? "secondary" : ""} pop-skip`} aria-pressed={!on} onClick={() => toggleChange(c.id, false)}>
          {on ? "Skip" : "Skipped"}
        </motion.button>
        <button type="button" className="btn ghost pop-edit" onClick={() => set({ editorOpen: true })}>Edit</button>
        {edited && <button type="button" className="btn ghost" onClick={() => resetEdit(c)}>Reset</button>}
      </div>
    </>
  );
}
