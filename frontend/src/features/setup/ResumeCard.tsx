import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { set, useApp } from "../../store/app";
import { StatusLine } from "../../ui/StatusLine";
import { Collapse } from "../../ui/Collapse";
import { StepNo } from "./StepNo";
import { browseResume, loadDefaultResume, loadResumePath, makeDefaultResume, uploadResume } from "./actions";

// switching between the default-resume row and the drop zone: height and fade, like the card's other sections
// (the inner padding leaves room for the drop zone's hover scale inside overflow-hidden)
const swap = {
  className: "-mx-1 -mb-1 overflow-hidden px-1 pb-1",
  initial: { height: 0, opacity: 0 }, animate: { height: "auto", opacity: 1 }, exit: { height: 0, opacity: 0 },
  transition: { duration: 0.26, ease: [0.2, 0.7, 0.2, 1] as const },
};

export function ResumeCard() {
  const { resume, resumePath, resumeStatus, resumeIsDefault, cfg } = useApp();
  const [over, setOver] = useState(false), [pathOpen, setPathOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // dropping a file anywhere else on the page shouldn't navigate away
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => { window.removeEventListener("dragover", stop); window.removeEventListener("drop", stop); };
  }, []);

  const loaded = !!resume;
  const hasDefault = !!cfg?.default_resume_path;
  // the default resume shows as a compact "loaded" row; "Use a different resume" brings back the drop zone and path box
  const [choosing, setChoosing] = useState(false);
  useEffect(() => setChoosing(false), [resume?.session_id]); // whatever loads next closes the chooser
  const showDefault = loaded && resumeIsDefault && !choosing;
  const zoneLoaded = loaded && !choosing;
  const placeholder = cfg?.os === "nt" ? `${cfg.home || "~"}\\Documents\\Resume.docx` : "~/Documents/Resume.docx";
  return (
    <section className={`card ${loaded ? "complete" : ""}`} id="resumeCard">
      <div className="mb-1 flex items-center gap-2.5"><StepNo n={1} done={loaded} /><h2>Your resume</h2></div>
      <AnimatePresence mode="wait" initial={false}>
        {showDefault ? (
          <motion.div key="default" {...swap}>
            <div id="defaultResume" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border-[1.5px] border-solid border-[color-mix(in_srgb,var(--color-sage)_35%,var(--color-line))] bg-sage-bg px-3.5 py-4">
              <motion.span aria-hidden="true" className="text-xl font-bold text-sage" initial={{ scale: 0.4, opacity: 0, rotate: -40 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 500, damping: 22 }}>✓</motion.span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="font-semibold break-all">{resume.file_name}</span><span className="tag sage">Default</span></div>
                <div className="text-[12.5px] text-ink-2">Loaded automatically. Change it in Settings.</div>
              </div>
              <button type="button" className="btn secondary" id="useDifferentBtn" onClick={() => setChoosing(true)}>Use a different resume</button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="choose" {...swap}>
            <motion.label id="dropzone" htmlFor="uploadInput"
              animate={{ scale: over ? 1.015 : 1 }} whileHover={{ scale: zoneLoaded ? 1 : 1.005 }} transition={{ type: "spring", stiffness: 400, damping: 28 }}
              onDragEnter={(e) => { e.preventDefault(); setOver(true); }} onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
              onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void uploadResume(f); }}
              className={`mt-3 grid cursor-pointer justify-items-center gap-0.5 rounded-card border-[1.5px] px-3.5 py-6 text-center transition-colors ${
                zoneLoaded ? "loaded border-solid border-[color-mix(in_srgb,var(--color-sage)_35%,var(--color-line))] bg-sage-bg"
                  : over ? "over border-dashed border-accent bg-accent-soft" : "border-dashed border-line-strong bg-canvas hover:border-accent hover:bg-accent-soft"}`}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={zoneLoaded ? "ok" : "up"} aria-hidden="true" className={`text-xl font-bold ${zoneLoaded ? "text-sage" : "text-accent"}`}
                  initial={{ scale: 0.4, opacity: 0, rotate: zoneLoaded ? -40 : 0 }} animate={{ scale: 1, opacity: 1, rotate: 0, y: over ? -3 : 0 }}
                  exit={{ scale: 0.4, opacity: 0 }} transition={{ type: "spring", stiffness: 500, damping: 22 }}>
                  {zoneLoaded ? "✓" : "↑"}
                </motion.span>
              </AnimatePresence>
              <span className="font-semibold">{zoneLoaded ? resume.file_name : choosing ? "Drop a different resume here" : "Drop your resume here"}</span>
              <span className="text-[12.5px] text-ink-2">{zoneLoaded ? "Drop another file to replace it" : "or click to choose · .docx, .pdf, .txt"}</span>
              <input ref={input} type="file" id="uploadInput" accept=".docx,.pdf,.txt,.md" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadResume(f); e.target.value = ""; }} />
            </motion.label>

            <div className="mt-3">
              <button type="button" className="linklike !text-[13px] !text-ink-2" aria-expanded={pathOpen} aria-controls="pathBox" onClick={() => setPathOpen(!pathOpen)}>
                <motion.span className="inline-block" animate={{ rotate: pathOpen ? 90 : 0 }}>▸</motion.span> Use a file path instead
              </button>
              <Collapse open={pathOpen} id="pathBox">
                <div className="mt-2.5 flex flex-wrap items-center gap-2 sm:flex-nowrap">
                  <input id="resumePath" className="field" type="text" spellCheck={false} placeholder={placeholder} aria-label="Path to your resume"
                    value={resumePath} onChange={(e) => set({ resumePath: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") void loadResumePath(); }} />
                  <button type="button" className="btn secondary" id="browseBtn" title="Open your system's file picker" onClick={() => void browseResume()}>Browse…</button>
                  <button type="button" className="btn secondary" id="loadBtn" onClick={() => void loadResumePath()}>Load</button>
                </div>
                <div className="hint">For example <code>~/Documents/resume.docx</code> or a pasted “Copy as path”.</div>
              </Collapse>
            </div>
            <Collapse open={choosing || (loaded && !resumeIsDefault)} id="resumeDefaultActions">
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                {choosing ? <>
                  <span className="text-ink-2">The one you pick is used for this session only.</span>
                  <button type="button" className="linklike" id="keepDefaultBtn" onClick={() => setChoosing(false)}>Keep my default</button>
                </> : <>
                  {hasDefault && <span className="text-ink-2">Used for this session only.</span>}
                  {hasDefault && <button type="button" className="linklike" id="backToDefaultBtn" onClick={loadDefaultResume}>Back to default</button>}
                  <button type="button" className="linklike" id="makeDefaultBtn" onClick={() => void makeDefaultResume()}>Make this my default</button>
                </>}
              </div>
            </Collapse>
          </motion.div>
        )}
      </AnimatePresence>
      <StatusLine id="resumeStatus" s={resumeStatus} />
    </section>
  );
}
