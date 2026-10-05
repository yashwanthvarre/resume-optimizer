import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SHEET_QUERY, useMedia } from "../../hooks/useMedia";
import type { Kw } from "../../lib/keywords";
import { useApp } from "../../store/app";
import { gapReason, keywordStats } from "../../store/derive";
import { toast } from "../../store/toasts";
import { Sheet } from "../../ui/Sheet";
import { setKwFilter, toggleChange } from "../review/actions";
import { closeSheet, openGaps } from "./actions";

const chipSpring = { type: "spring", stiffness: 500, damping: 36 } as const;

interface Tip { term: string; el: HTMLElement; at: number }

/** "Why wasn't this added?" next to a Not-added chip: hover with a mouse, focus with the keyboard, tap on touch. */
function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef(0), refocus = useRef(false);
  const show = useCallback((el: HTMLElement) => {
    clearTimeout(timer.current);
    if (refocus.current) return;
    setTip((t) => (t && t.el === el ? t : { term: el.dataset.term!, el, at: performance.now() }));
  }, []);
  const hide = useCallback(() => { clearTimeout(timer.current); setTip(null); }, []);
  const hideSoon = useCallback(() => { clearTimeout(timer.current); timer.current = window.setTimeout(() => setTip(null), 250); }, []);
  const keep = useCallback(() => clearTimeout(timer.current), []);
  return { tip, show, hide, hideSoon, keep, refocus };
}

function KwTip({ tip, k, onClose, onKeep, onLeave }: { tip: Tip; k: Kw; onClose: (refocus?: boolean) => void; onKeep: () => void; onLeave: () => void }) {
  const s = useApp();
  const sheet = useMedia(SHEET_QUERY);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const r = gapReason(s, k);
  useLayoutEffect(() => {
    if (sheet || !ref.current) return;
    const box = tip.el.getBoundingClientRect(), t = ref.current;
    setPos({
      left: Math.max(12, Math.min(box.left, document.documentElement.clientWidth - t.offsetWidth - 12)),
      top: Math.min(box.bottom + 6, innerHeight - t.offsetHeight - 12),
    });
  }, [tip, sheet]);
  useEffect(() => {
    tip.el.setAttribute("aria-describedby", "kwTip");
    return () => tip.el.removeAttribute("aria-describedby");
  }, [tip]);
  return (
    <motion.div ref={ref} id="kwTip" role="tooltip"
      className="floating z-45 w-[min(320px,calc(100vw-32px))] rounded-card border border-line bg-paper px-3.5 py-3 text-[13.5px] leading-normal text-ink shadow-2"
      style={sheet ? undefined : { position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? 0 }}
      initial={sheet ? { y: "100%" } : { opacity: 0, y: 4 }} animate={sheet ? { y: 0 } : { opacity: 1, y: 0 }} exit={sheet ? { y: "100%" } : { opacity: 0 }}
      transition={{ duration: 0.14 }}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") onKeep(); }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse") onLeave(); }}
      onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node) && e.relatedTarget !== tip.el) onLeave(); }}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <b>{k.term}</b><span className="muted small mr-auto capitalize">{k.importance || ""}</span>
        <button type="button" className="btn ghost icon sm" aria-label="Close" onClick={() => onClose()}>✕</button>
      </div>
      <div>{r.text}</div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {r.change && <button type="button" className="btn secondary sm" onClick={() => { toggleChange(r.change!, true); onClose(); toast("Edit accepted", "ok"); }}>Accept that edit</button>}
        <button type="button" className="btn sm" onClick={() => { onClose(); openGaps([k.term]); }}>I have experience with this →</button>
      </div>
    </motion.div>
  );
}

export function KeywordsPanel() {
  const s = useApp();
  const open = s.sheet === "keywords" && s.view === "review" && !!s.analysis;
  const k = useMemo(() => (s.analysis ? keywordStats(s) : null), [s.kws, s.selected, s.edits, s.analysis, s.resume]);
  const { tip, show, hide, hideSoon, keep, refocus } = useTip();
  const outRef = useRef<HTMLDivElement>(null);

  // close the tip with Escape (before the sheet sees it), or a click elsewhere
  useEffect(() => {
    if (!tip) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const inTip = document.getElementById("kwTip")?.contains(document.activeElement);
      hide(); e.stopPropagation();
      if (inTip) { refocus.current = true; tip.el.focus(); refocus.current = false; } // return focus without reopening
    };
    const click = (e: MouseEvent) => {
      if ((e.target as Element).closest("#kwTip, #kwOut")) return;
      if (performance.now() - tip.at > 400) hide(); // the tap that opened it can land elsewhere
    };
    document.addEventListener("keydown", key, true);
    document.addEventListener("click", click);
    document.addEventListener("scroll", hide, { capture: true, passive: true }); // the sheet scrolled under it
    return () => {
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("click", click);
      document.removeEventListener("scroll", hide, { capture: true });
    };
  }, [tip, hide, refocus]);
  useEffect(() => { if (!open) hide(); }, [open, hide]);
  useEffect(hide, [s.selected, s.edits, hide]);

  if (!k) return null;
  const hard = k.outKw.filter((x) => x.category !== "soft_skill"), soft = k.outKw.filter((x) => x.category === "soft_skill");
  const chipEl = (e: { target: EventTarget }) => (e.target as Element).closest<HTMLElement>(".chip");
  const outChip = (x: Kw) => (
    <motion.button key={x.term} layout layoutId={`kw-${x.term}`} transition={chipSpring} type="button" data-term={x.term}
      className={`chip out ${x.importance === "required" ? "req" : ""} ${x.category === "soft_skill" ? "soft" : ""}`}>{x.term}</motion.button>
  );
  const tipKw = tip && s.kws.find((x) => x.term === tip.term);

  return (
    <>
      <Sheet id="kwDlg" labelId="kwTitle" open={open} onClose={() => { closeSheet(); document.getElementById("kwSummaryBtn")?.focus(); }} title="Keywords"
        sub={<span id="kwStats">Your resume had {k.had}. With your edits it has {k.nowN} of the {k.total} keywords in this job.</span>}>
        <div className="contents">
          <div className="mt-1.5 mb-2 flex h-1.5 overflow-hidden rounded-full bg-sunk" aria-hidden="true">
            <motion.span className="h-full bg-sage" initial={{ width: 0 }} animate={{ width: `${k.total ? (100 * Math.min(k.had, k.nowN)) / k.total : 0}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
            <motion.span className="h-full bg-sky" initial={{ width: 0 }} animate={{ width: `${k.total ? (100 * Math.max(0, k.added)) / k.total : 0}%` }} transition={{ type: "spring", stiffness: 120, damping: 20, delay: 0.1 }} />
          </div>
          {k.req.length > 0 && <p className="small muted">Required: {k.reqHit} of {k.req.length} covered</p>}
          <LayoutGroup>
            <h4>In your resume <span className="muted">({k.inKw.length})</span></h4>
            <div id="kwIn" className="mb-2 flex flex-wrap gap-1.5"
              onClick={(e) => { const ch = chipEl(e); if (ch) { closeSheet(); setKwFilter(s.kwFilter === ch.dataset.term ? null : ch.dataset.term!); } }}>
              {k.inKw.map((x) => (
                <motion.button key={x.term} layout layoutId={`kw-${x.term}`} transition={chipSpring} type="button" data-term={x.term}
                  className={`chip in ${x.term === s.kwFilter ? "active" : ""}`} title="Show the edits that add it">
                  {x.term}{!k.before.has(x.term) && <span className="new-tag">new</span>}
                </motion.button>
              ))}
              {!k.inKw.length && <span className="muted small">None yet.</span>}
            </div>
            <p className="muted small"><span className="new-tag">new</span> added by the edits you accepted. Click a keyword to see those edits on the page.</p>
            <h4>Not added <span className="muted">({k.outKw.length})</span></h4>
            <div id="kwOut" ref={outRef} className="mb-2 flex flex-wrap gap-1.5"
              onPointerOver={(e) => { if (e.pointerType !== "mouse") return; const ch = chipEl(e); if (ch && ch !== tip?.el) show(ch); else keep(); }}
              onPointerLeave={(e) => { if (e.pointerType === "mouse") hideSoon(); }}
              onFocus={(e) => { const ch = chipEl(e); if (ch) show(ch); }}
              onBlur={(e) => { if (!document.getElementById("kwTip")?.contains(e.relatedTarget as Node)) hideSoon(); }}
              onClick={(e) => {
                const ch = chipEl(e);
                if (!ch) return;
                // a tap fires pointerover then click: don't let the click undo the open that just happened
                if (tip?.el === ch && performance.now() - tip.at > 400) hide(); else show(ch);
              }}>
              {hard.map(outChip)}
              {soft.length > 0 && <div className="mt-1.5 basis-full text-xs text-ink-3">Soft skills, usually shown through your bullets rather than listed</div>}
              {soft.map(outChip)}
              {!k.outKw.length && <span className="muted small">Every keyword is covered.</span>}
            </div>
          </LayoutGroup>
          <p className="muted small">★ required. Hover or tap a keyword to see why it wasn't added.</p>
          {k.outKw.length > 0 && <button type="button" className="btn mt-3.5" id="kwGaps" onClick={() => openGaps()}>Add missing keywords →</button>}
          <div className="sr-only" aria-live="polite">Your resume now has {k.nowN} of {k.total} keywords.</div>
        </div>
      </Sheet>
      <AnimatePresence>
        {open && tip && tipKw && <KwTip key={tip.term} tip={tip} k={tipKw} onKeep={keep} onLeave={hideSoon}
          onClose={() => hide()} />}
      </AnimatePresence>
    </>
  );
}
