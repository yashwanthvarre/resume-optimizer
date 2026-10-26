import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { useAutosize } from "../../hooks/useAutosize";
import { SHEET_QUERY, useMedia } from "../../hooks/useMedia";
import { set, useApp } from "../../store/app";
import { ClaudeIcon } from "../../ui/ClaudeIcon";
import { StatusLine } from "../../ui/StatusLine";
import { Diff, usePosition } from "./EditPopover";
import { applyRefine, closeRefine, pickRefine, refineLines, stopRefine, submitRefine } from "./refine";

const IDEAS = ["The keyword feels forced here", "Make it shorter", "Use a stronger verb", "Put the keyword earlier"];

/** Ask Claude about one highlighted line: tell it what to change and it applies it, or get 3 rewrites and pick one. */
export function RefinePopover() {
  const s = useApp();
  const sheet = useMedia(SHEET_QUERY);
  const r = s.view === "review" ? s.refine : null;
  const para = r && `${refineLines(r.id)?.c.target_id}${r.line ? `-${r.line}` : ""}`; // the line, if its highlight is gone
  const pos = usePosition(r ? [`#${CSS.escape(r.anchor)}`, `#pp-${CSS.escape(para!)}`] : null, sheet);

  useEffect(() => {
    if (!r) return;
    const down = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.("#refinePop, .ask, .pop-ask, .sheet, [role=dialog], .toasts")) closeRefine();
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [r]);

  const show = !!r && (sheet || !!pos);
  return (
    <AnimatePresence>
      {show && r && (
        <motion.div key="refine" id="refinePop" role="dialog" aria-labelledby="refineTitle"
          className="floating no-print z-25 grid gap-2.5 rounded-card border border-line bg-paper px-4 pt-3.5 pb-3 text-sm shadow-2"
          style={sheet ? undefined : { width: pos!.width }}
          initial={sheet ? { y: "100%" } : { opacity: 0, scale: 0.96, left: pos!.left, top: pos!.top - 6 }}
          animate={sheet ? { y: 0 } : { opacity: 1, scale: 1, left: pos!.left, top: pos!.top }}
          exit={sheet ? { y: "100%" } : { opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
          transition={{ type: "spring", stiffness: 520, damping: 40 }}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); closeRefine(); } }}>
          <RefineBody />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function RefineBody() {
  const { refine: r, refineAsk: ask, refineJob: job, refineStatus, refineOptions: options, refineApplied: applied } = useApp();
  const ref = useAutosize(ask);
  useEffect(() => { ref.current?.focus(); }, [ref, r?.id, r?.line]);
  const got = r && refineLines(r.id);
  if (!r || !got) return null;
  const line = got.lines[r.line] ?? "", busy = !!job;
  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className="text-claude"><ClaudeIcon size={16} /></span>
        <span className="mr-auto text-xs font-semibold tracking-[.04em] text-ink-3 uppercase" id="refineTitle">Ask Claude · {got.c.section}</span>
        <button type="button" className="btn ghost icon sm" aria-label="Close" onClick={closeRefine}>✕</button>
      </div>
      <p className="border-l-2 border-line-strong pl-2.5 text-ink-2" id="refineLine">{line.replace(/^[\s•●▪■◦‣∙·\-–*]+/, "")}</p>
      <textarea ref={ref} id="refineAsk" className="field min-h-16 resize-none overflow-hidden" rows={2} value={ask} disabled={busy}
        aria-label="What should Claude change about this line?" placeholder="Tell Claude what to change — press Enter to apply"
        onChange={(e) => set({ refineAsk: e.target.value })}
        onKeyDown={(e) => {
          // Enter applies, Ctrl/Cmd+Enter asks for 3 options, Shift+Enter is a new line
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
          e.preventDefault();
          void (e.ctrlKey || e.metaKey ? submitRefine() : applyRefine());
        }} />
      {!ask.trim() && !busy && (
        <div className="flex flex-wrap gap-1.5">
          {IDEAS.map((x) => <button key={x} type="button" className="chip out" onClick={() => set({ refineAsk: x })}>{x}</button>)}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {busy ? <button type="button" className="btn secondary sm" id="refineStop" onClick={stopRefine}>Stop</button>
          : <>
            <button type="button" className="btn sm" id="refineApply" disabled={!ask.trim()} title="Enter" onClick={() => void applyRefine()}><ClaudeIcon />Apply with Claude</button>
            <button type="button" className="btn secondary sm" id="refineGo" disabled={!ask.trim()} title="Ctrl+Enter" onClick={() => void submitRefine()}>{options ? "Try again" : "Get 3 options"}</button>
          </>}
        <button type="button" className="btn ghost sm" onClick={closeRefine}>Cancel</button>
        <StatusLine s={refineStatus} className="!m-0" />
      </div>
      <AnimatePresence>
        {applied && (
          <motion.div className="grid gap-1.5 border-t border-line pt-2.5" id="refineApplied" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="text-xs font-semibold tracking-[.04em] text-ink-3 uppercase">Check this before it goes in</div>
            <Diff a={line} b={applied.text} mode="inline" />
            {applied.warnings.map((w) => <span key={w} className="warn !m-0 block">{w}</span>)}
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="btn sm" id="refineUse" onClick={() => pickRefine(applied.text)}>Use it</button>
              <button type="button" className="btn ghost sm" id="refineDiscard" onClick={() => set({ refineApplied: null })}>Discard</button>
            </div>
          </motion.div>
        )}
        {options && (
          <motion.div className="grid gap-1.5 border-t border-line pt-2.5" id="refineOptions" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="text-xs font-semibold tracking-[.04em] text-ink-3 uppercase">Pick one to use it</div>
            {options.map((o, i) => (
              <motion.button key={o.text} type="button" className="refine-opt" data-opt={i} onClick={() => pickRefine(o.text)}
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.05 } }} whileTap={{ scale: 0.98 }}>
                <span className="text-xs font-semibold text-ink-2">{o.note || `Option ${i + 1}`}</span>
                <Diff a={line} b={o.text} mode="inline" />
                {o.warnings.map((w) => <span key={w} className="warn !m-0 block">{w}</span>)}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
