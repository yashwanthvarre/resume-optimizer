import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useAutosize } from "../../hooks/useAutosize";
import { get, set, useApp, type Letter } from "../../store/app";
import { contactHeader, outFormat, roleLine } from "../../store/derive";
import { Collapse } from "../../ui/Collapse";
import { Seg } from "../../ui/Seg";
import { StatusLine } from "../../ui/StatusLine";
import { View } from "../../ui/View";
import { FileLine } from "../review/FileLine";
import { backToReview, cancelCover, doExport, wordCount, writeCover } from "./actions";

const editLetter = (patch: Partial<Letter>) => set((s) => ({ letter: { ...s.letter, ...patch }, coverEdited: true }));

function Para({ i, text }: { i: number; text: string }) {
  const ref = useAutosize(text);
  return (
    <motion.textarea ref={ref} className="lt para" rows={3} aria-label={`Paragraph ${i + 1}`} value={text}
      variants={{ hide: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
      onChange={(e) => set((s) => {
        const paragraphs = [...s.letter.paragraphs];
        paragraphs[i] = e.target.value;
        return { letter: { ...s.letter, paragraphs }, coverEdited: true };
      })} />
  );
}

function Form() {
  const { manager, why, tone, coverFormOpen, cover, coverEdited, coverJob, coverStatus } = useApp();
  const running = coverJob?.status === "running";
  const [confirm, setConfirm] = useState(false), [cancelling, setCancelling] = useState(false);
  useEffect(() => { if (!running) setCancelling(false); }, [running]);
  const go = () => {
    if (cover && coverEdited && !confirm) return setConfirm(true); // regenerating replaces the user's edits
    setConfirm(false);
    void writeCover();
  };
  return (
    <section className="card cover-form no-print !p-0" id="cvFormAcc">
      <button type="button" aria-expanded={coverFormOpen} onClick={() => set({ coverFormOpen: !coverFormOpen })}
        className="flex w-full cursor-pointer flex-wrap items-baseline gap-2.5 px-5 py-3.5 text-left font-semibold">
        <span>Personalize</span><span className="muted small font-normal">Hiring manager, tone, why this company</span>
        <motion.span className="ml-auto text-ink-3" animate={{ rotate: coverFormOpen ? 0 : -90 }}>▾</motion.span>
      </button>
      <Collapse open={coverFormOpen}>
        <div className="grid grid-cols-1 gap-x-4 px-5 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="cvManager">Hiring manager <span className="muted">(optional)</span></label>
            <input id="cvManager" className="field" type="text" placeholder="e.g. Priya Shah" value={manager} onChange={(e) => set({ manager: e.target.value })} />
          </div>
          <div>
            <div className="label" id="toneLbl">Tone</div>
            <Seg id="toneSeg" labelledBy="toneLbl" value={tone} onChange={(t) => set({ tone: t })}
              options={[{ value: "formal", label: "Formal" }, { value: "warm", label: "Warm" }, { value: "concise", label: "Concise" }]} />
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="cvWhy">Why this company? <span className="muted">(optional)</span></label>
            <textarea id="cvWhy" className="field" rows={3} placeholder="A product you use, their mission, someone you spoke with…" value={why} onChange={(e) => set({ why: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 px-5 pt-3.5 pb-1">
          <motion.button type="button" className="btn" id="cvGenerate" disabled={running} onClick={go} whileTap={{ scale: 0.96 }}>
            {confirm ? "Replace my edits and write again" : cover ? "Write it again" : "Write cover letter"}
          </motion.button>
          {confirm && <button type="button" className="btn ghost" onClick={() => setConfirm(false)}>Keep my letter</button>}
          {running && <button type="button" className="btn ghost" id="cvCancel" disabled={cancelling} onClick={() => { setCancelling(true); cancelCover(); }}>{cancelling ? "Cancelling…" : "Cancel"}</button>}
          <span className="hint !m-0 min-w-[200px] flex-1">
            {confirm ? "Writing it again replaces the edits you made to the letter." : "Uses the job analysis and the edits you accepted. Nothing is claimed that your resume doesn't support."}
          </span>
        </div>
        <StatusLine id="cvStatus" s={coverStatus} className="px-5 pb-3.5 empty:p-0" />
      </Collapse>
    </section>
  );
}

function Paper() {
  const s = useApp();
  const { cover, letter } = s;
  const hdr = useMemo(() => contactHeader(s), [s.resume, s.analysis, s.selected, s.edits]);
  const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return (
    <article className="page letter" id="cvPaper">
      <AnimatePresence mode="wait">
        {!cover ? (
          <motion.div key="empty" className="py-20 text-center font-sans text-ink-3" id="cvEmpty" exit={{ opacity: 0 }}>
            {s.coverJob?.status === "running" ? <LetterSkeleton /> : "Your cover letter will appear here."}
          </motion.div>
        ) : (
          <motion.div key={cover.paragraphs[0]} id="cvBody" initial="hide" animate="show" variants={{ show: { transition: { staggerChildren: 0.09 } } }}>
            <motion.div variants={{ hide: { opacity: 0 }, show: { opacity: 1 } }} className="mb-5 border-b border-[#e3e3e8] pb-3">
              {hdr.map((l, i) => <div key={i} className={i ? "text-[12.5px] text-[#6e6e73]" : "text-[22px] font-bold"}>{l}</div>)}
            </motion.div>
            <motion.div variants={{ hide: { opacity: 0 }, show: { opacity: 1 } }} className="mb-3.5">{date}</motion.div>
            <input className="lt" id="cvGreeting" aria-label="Greeting" value={letter.greeting} onChange={(e) => editLetter({ greeting: e.target.value })} />
            <div id="cvParas">{letter.paragraphs.map((p, i) => <Para key={i} i={i} text={p} />)}</div>
            <input className="lt !mt-1.5 !mb-0.5" id="cvClosing" aria-label="Closing" value={letter.closing} onChange={(e) => editLetter({ closing: e.target.value })} />
            <input className="lt font-semibold" id="cvSignature" aria-label="Signature" value={letter.signature} onChange={(e) => editLetter({ signature: e.target.value })} />
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}

/** Lines that shimmer while Claude writes. */
function LetterSkeleton() {
  return (
    <div className="grid gap-3 text-left" aria-label="Writing your cover letter">
      {[92, 100, 96, 70, 0, 100, 94, 98, 60].map((w, i) => (
        <motion.div key={i} className="h-3 rounded-full bg-sunk" style={{ width: `${w}%`, visibility: w ? "visible" : "hidden" }}
          animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.08 }} />
      ))}
    </div>
  );
}

export function CoverView() {
  const s = useApp();
  const { view, cover, letter, boldLetterKw, exporting, cvExportStatus, cfg } = s;
  const word = outFormat(cfg) === "docx" ? ".docx" : "PDF";
  // no letter yet: start at the first field
  useEffect(() => { if (view === "cover" && !get().cover) setTimeout(() => document.getElementById("cvManager")?.focus({ preventScroll: true }), 120); }, [view]);
  const n = wordCount(letter.paragraphs.join(" "));
  return (
    <View id="coverView" visible={view === "cover"} className="print-plain mx-auto grid max-w-[960px] gap-3.5 px-4 pt-[18px] pb-14 sm:pt-7">
      {s.analysis && (
        <>
          <header className="no-print grid gap-1.5">
            <motion.button type="button" className="linklike mb-1.5 justify-self-start" id="coverBack" whileHover={{ x: -2 }} onClick={backToReview}>← Back to resume</motion.button>
            <div className="text-xs font-semibold tracking-[.06em] text-ink-3 uppercase">Cover letter for</div>
            <h1 id="cvRole">{roleLine(s)}</h1>
          </header>
          <Form />
          <div id="cvBar" className="doc-bar no-print static z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line py-1.5 pr-1.5 pl-3 shadow-1 md:sticky md:top-[calc(var(--topbar-h)+8px)]">
            <span className="muted small" id="cvWords">{cover ? `${n} words${n < 250 || n > 400 ? " · aim for 250–400" : ""}` : "No letter yet"}</span>
            <span className="flex-1" />
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] whitespace-nowrap text-ink-2" title="Bold the job's keywords in the downloaded letter">
              <input type="checkbox" id="cvBoldKw" className="size-4 accent-accent" checked={boldLetterKw} onChange={(e) => set({ boldLetterKw: e.target.checked })} /> Bold keywords
            </label>
            <button type="button" className="btn secondary" id="cvExport" disabled={!cover || !!exporting} onClick={() => void doExport("cover")}>Download letter ({word})</button>
            <button type="button" className="btn" id="bothExport" disabled={!cover || !!exporting} onClick={() => void doExport("both")}>Download both (.zip)</button>
          </div>
          <StatusLine id="cvExportStatus" s={cvExportStatus} className="no-print mx-2 !mt-0 empty:hidden" />
          {cover && cover.warnings.length > 0 && <div id="cvWarnings" className="no-print">{cover.warnings.map((w) => <div key={w} className="warn">{w}</div>)}</div>}
          <Paper />
          <p className="no-print muted small text-center" id="cvFileNote"><FileLine kind="cover" /></p>
          {cover && cover.evidence.length > 0 && (
            <details className="no-print w-full max-w-[820px] justify-self-center text-[13.5px]" id="cvEvidence">
              <summary className="cursor-pointer font-medium text-accent">Why each point was made</summary>
              <ul className="mt-2 grid list-disc gap-2 pl-[18px]">
                {cover.evidence.map((e, i) => (
                  <li key={i}><b>{e.jd_requirement}</b><span className="muted small block">Your resume: “{e.resume_evidence}”</span></li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </View>
  );
}
