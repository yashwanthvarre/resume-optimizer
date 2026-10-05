import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { get, set, useApp } from "../../store/app";
import { keywordStats, outFormat, roleLine, visibleEdits } from "../../store/derive";
import { AnimatedNumber } from "../../ui/AnimatedNumber";
import { Seg } from "../../ui/Seg";
import { StatusLine } from "../../ui/StatusLine";
import { View } from "../../ui/View";
import { doExport, showCover } from "../coverLetter/actions";
import { openGaps, openKeywords } from "../keywords/actions";
import { closePop, selectAll, setDiffMode, setFilter, setKwFilter, stepPop, toggleChange } from "./actions";
import { FileLine } from "./FileLine";
import { ResumePage } from "./ResumePage";

const noticeText = (n: string | { text: string }) => (typeof n === "string" ? n : n.text);

function DocHead() {
  const analysis = useApp((s) => s.analysis)!, noticeOpen = useApp((s) => s.noticeOpen);
  const [open, setOpen] = useState(false), [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  const text = analysis.overall_assessment || analysis.jd.summary || "";
  useLayoutEffect(() => {
    setOpen(false);
    const a = ref.current;
    if (a) requestAnimationFrame(() => setClamped(a.scrollHeight > a.clientHeight + 2));
  }, [text]);
  const notices = (analysis.notices || []).map(noticeText);
  return (
    <header className="grid gap-1.5">
      <div className="text-xs font-semibold tracking-[.06em] text-ink-3 uppercase">Tailoring for</div>
      <h1 id="rvRole">{roleLine({ analysis }) || "Your resume"}</h1>
      <motion.p ref={ref} id="rvAssessment" layout className={`assessment max-w-[70ch] text-ink-2 ${open ? "" : "line-clamp-2"}`}>{text}</motion.p>
      {clamped && <button type="button" className="linklike no-print justify-self-start" id="rvMore" onClick={() => setOpen(!open)}>{open ? "Less" : "More"}</button>}
      <AnimatePresence>
        {notices.length > 0 && noticeOpen && (
          <motion.div id="rvNotices" role="note" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden">
            <div className="mt-1.5 flex items-start justify-between gap-2.5 rounded-ctl bg-butter-bg py-[9px] pr-2.5 pl-3.5 text-[13.5px] text-ink">
              <div><b className="text-butter">From the job posting:</b> {notices.join(" ")}</div>
              <button type="button" className="btn ghost icon sm no-print !text-butter" aria-label="Dismiss this notice" onClick={() => set({ noticeOpen: false })}>✕</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function MoreMenu() {
  const { menuOpen, selected, analysis, showMarks, diffMode } = useApp();
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    wrap.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const click = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) set({ menuOpen: false }); };
    document.addEventListener("click", click);
    return () => document.removeEventListener("click", click);
  }, [menuOpen]);
  const n = selected.size, total = analysis?.changes.length || 0;
  const item = "flex w-full items-center justify-between gap-3 rounded-ctl px-2.5 py-2 text-left text-[13.5px] font-medium text-ink hover:bg-sunk focus-visible:bg-sunk focus-visible:outline-none";
  return (
    <div className="relative" ref={wrap} onKeyDown={(e) => { if (e.key === "Escape" && menuOpen) { e.stopPropagation(); set({ menuOpen: false }); document.getElementById("moreBtn")?.focus(); } }}>
      <button type="button" className="btn ghost icon" id="moreBtn" aria-haspopup="true" aria-expanded={menuOpen} aria-controls="moreMenu" aria-label="More options"
        onClick={(e) => { e.stopPropagation(); set({ menuOpen: !menuOpen }); }}>⋯</button>
      <AnimatePresence>
        {menuOpen && (
          <motion.div id="moreMenu" role="menu" className="absolute top-[calc(100%+6px)] right-0 z-30 grid max-w-[calc(100vw-24px)] min-w-[250px] origin-top-right gap-0.5 rounded-card border border-line bg-paper p-1.5 shadow-2"
            initial={{ opacity: 0, scale: 0.94, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.1 } }}
            transition={{ type: "spring", stiffness: 600, damping: 36 }}>
            <div className="px-2.5 pt-2 pb-0.5 text-[11.5px] font-semibold tracking-[.05em] text-ink-3 uppercase" id="selCount">
              {total ? `${n} of ${total} edits accepted` : "No edits needed"}
            </div>
            <button type="button" role="menuitem" className={item} id="selAll" onClick={() => selectAll(true)}>Accept all edits</button>
            <button type="button" role="menuitem" className={item} id="selNone" onClick={() => selectAll(false)}>Skip all edits</button>
            <label className={`${item} cursor-pointer`}>
              <span>Show changes on the page</span>
              <input type="checkbox" id="hlToggle" className="size-[18px] accent-accent" checked={showMarks} onChange={(e) => set({ showMarks: e.target.checked })} />
            </label>
            <div className="px-2.5 pt-2 pb-0.5 text-[11.5px] font-semibold tracking-[.05em] text-ink-3 uppercase" id="diffLbl">In the edit popover</div>
            <Seg id="diffSeg" className="mx-1.5 mb-1.5" labelledBy="diffLbl" value={diffMode} onChange={setDiffMode}
              options={[{ value: "auto", label: "Auto", title: "Inline for small edits, Before / After for big rewrites" }, { value: "inline", label: "Inline" }, { value: "stacked", label: "Before / After" }]} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DocBar() {
  const s = useApp();
  const k = useMemo(() => keywordStats(s), [s.kws, s.selected, s.edits, s.analysis, s.resume]);
  const word = outFormat(s.cfg) === "docx" ? ".docx" : "PDF", n = s.selected.size;
  return (
    <>
      <div id="docBar" className="doc-bar no-print static z-10 grid gap-2 rounded-2xl border border-line p-2 shadow-1 md:sticky md:top-[calc(var(--topbar-h)+8px)] md:flex md:flex-wrap md:items-center md:gap-x-3 md:gap-y-2 md:py-1.5 md:pr-1.5 md:pl-2">
        <div className="flex flex-wrap items-center justify-between gap-1.5 md:justify-start">
          <button type="button" id="kwSummaryBtn" aria-controls="kwDlg" title="See all keywords" onClick={openKeywords}
            className="inline-flex cursor-pointer flex-wrap items-baseline gap-2 rounded-full bg-transparent px-2.5 py-[5px] text-sm font-semibold text-ink hover:bg-sunk focus-visible:shadow-[var(--ring)] focus-visible:outline-none">
            <span id="kwLine"><AnimatedNumber value={k.nowN} /> of {k.total} keywords</span>
            <AnimatePresence>
              {k.added > 0 && (
                <motion.span key="d" id="kcDelta" className="text-[12.5px] font-semibold text-sage" title={`${k.added} added by your edits`}
                  initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}>+{k.added}</motion.span>
              )}
            </AnimatePresence>
            <span id="kwMissing" className="text-[12.5px] font-medium text-ink-2">{k.missing ? `${k.missing} missing` : "all covered"}</span>
          </button>
          {k.outKw.length > 0 && (
            <button type="button" className="btn secondary sm" id="gapsOpen" onClick={() => openGaps()}>Add {k.outKw.length} keyword{k.outKw.length === 1 ? "" : "s"}</button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-1.5 md:justify-start">
          <Seg id="filterSeg" label="Show edits" value={s.filter} onChange={setFilter}
            options={[{ value: "all", label: "All" }, { value: "on", label: "Accepted" }, { value: "off", label: "Skipped" }]} />
          <AnimatePresence>
            {s.kwFilter && (
              <motion.span id="kwFilter" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
                className="inline-flex items-center gap-1 rounded-full bg-sky-bg py-[3px] pr-1 pl-2.5 text-[12.5px] font-semibold text-sky">
                Adds “{s.kwFilter}”
                <button type="button" aria-label="Clear keyword filter" className="cursor-pointer rounded-full px-1.5 text-xs hover:bg-black/5" onClick={() => setKwFilter(null)}>✕</button>
              </motion.span>
            )}
          </AnimatePresence>
          <MoreMenu />
        </div>
        <div className="flex items-center gap-1.5 md:ml-auto [&>button]:flex-1 md:[&>button]:flex-none">
          <button type="button" className="btn secondary" id="exportBtn" disabled={!!s.exporting}
            title={n ? `Download your resume with ${n} edit${n === 1 ? "" : "s"}` : "Download your resume unchanged"} onClick={() => void doExport("resume")}>
            Download {word}
          </button>
          <motion.button type="button" className="btn" id="toCover" whileHover={{ x: 2 }} onClick={showCover}>Cover letter →</motion.button>
        </div>
      </div>
      <StatusLine id="exportStatus" s={s.exportStatus} className="mx-2 !mt-0 empty:hidden" />
    </>
  );
}

function FmtNote() {
  const { resume, cfg } = useApp();
  if (!resume) return null;
  const f = outFormat(cfg);
  const fmt = resume.keeps_formatting ? "Your Word layout is kept when you download." : "Download builds a clean new .docx (PDF/TXT layout can't be kept).";
  const out = f === "pdf" ? " Downloads as a PDF with the font embedded." : f === "both" ? " Downloads as a PDF; the .docx is saved next to it." : "";
  const missing = cfg?.file_format !== "docx" && !cfg?.pdf_converter ? ` ${cfg?.pdf_missing} Saving .docx for now.` : "";
  return (
    <p className="no-print muted small text-center" id="fmtNote">
      {fmt + out}
      {cfg?.doc_font !== "keep" && f !== "pdf" && <> The .docx is set in EB Garamond: Word shows it only where the font is installed (<a href="https://fonts.google.com/specimen/EB+Garamond" target="_blank" rel="noopener">get it free</a>).</>}
      {missing}
      <FileLine kind="resume" />
    </p>
  );
}

/** j/k move between edits; Space/x accept or skip; e edits; a/n accept or skip all; h hides marks; Esc closes. */
function useReviewKeys(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const s = get();
      if (s.sheet || s.settingsOpen) return; // panels have their own keys
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === " " && t.closest("button, summary")) return;
      switch (e.key) {
        case "j": case "ArrowDown": if (!visibleEdits(s).length) return; stepPop(1); break;
        case "k": case "ArrowUp": if (!visibleEdits(s).length) return; stepPop(-1); break;
        case " ": case "x": if (!s.pop) return; toggleChange(s.pop); break;
        case "e": if (!s.pop) return; set({ editorOpen: true }); break;
        case "a": selectAll(true); break;
        case "n": selectAll(false); break;
        case "h": set({ showMarks: !s.showMarks }); break;
        case "Escape": if (s.menuOpen) set({ menuOpen: false }); else if (s.pop) closePop(); else if (s.kwFilter) setKwFilter(null); else return; break;
        default: return;
      }
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active]);
}

export function ReviewView() {
  const view = useApp((s) => s.view), analysis = useApp((s) => s.analysis);
  useReviewKeys(view === "review");
  return (
    <View id="reviewView" visible={view === "review"} className="print-plain mx-auto grid max-w-[960px] gap-3.5 px-4 pt-[18px] pb-14 sm:pt-7">
      {analysis && (
        <>
          <DocHead />
          <DocBar />
          <ResumePage />
          <FmtNote />
        </>
      )}
    </View>
  );
}
