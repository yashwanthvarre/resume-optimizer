import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { set, useApp } from "../../store/app";
import { StatusLine } from "../../ui/StatusLine";
import { Collapse } from "../../ui/Collapse";
import { StepNo } from "./StepNo";
import { browseResume, loadResumePath, uploadResume } from "./actions";

export function ResumeCard() {
  const { resume, resumePath, resumeStatus, cfg } = useApp();
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
  const placeholder = cfg?.os === "nt" ? `${cfg.home || "~"}\\Documents\\Resume.docx` : "~/Documents/Resume.docx";
  return (
    <section className={`card ${loaded ? "complete" : ""}`} id="resumeCard">
      <div className="mb-1 flex items-center gap-2.5"><StepNo n={1} done={loaded} /><h2>Your resume</h2></div>
      <motion.label id="dropzone" htmlFor="uploadInput"
        animate={{ scale: over ? 1.015 : 1 }} whileHover={{ scale: loaded ? 1 : 1.005 }} transition={{ type: "spring", stiffness: 400, damping: 28 }}
        onDragEnter={(e) => { e.preventDefault(); setOver(true); }} onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void uploadResume(f); }}
        className={`mt-3 grid cursor-pointer justify-items-center gap-0.5 rounded-card border-[1.5px] px-3.5 py-6 text-center transition-colors ${
          loaded ? "loaded border-solid border-[color-mix(in_srgb,var(--color-sage)_35%,var(--color-line))] bg-sage-bg"
            : over ? "over border-dashed border-accent bg-accent-soft" : "border-dashed border-line-strong bg-canvas hover:border-accent hover:bg-accent-soft"}`}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={loaded ? "ok" : "up"} aria-hidden="true" className={`text-xl font-bold ${loaded ? "text-sage" : "text-accent"}`}
            initial={{ scale: 0.4, opacity: 0, rotate: loaded ? -40 : 0 }} animate={{ scale: 1, opacity: 1, rotate: 0, y: over ? -3 : 0 }}
            exit={{ scale: 0.4, opacity: 0 }} transition={{ type: "spring", stiffness: 500, damping: 22 }}>
            {loaded ? "✓" : "↑"}
          </motion.span>
        </AnimatePresence>
        <span className="font-semibold">{loaded ? resume.file_name : "Drop your resume here"}</span>
        <span className="text-[12.5px] text-ink-2">{loaded ? "Drop another file to replace it" : "or click to choose · .docx, .pdf, .txt"}</span>
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
      <StatusLine id="resumeStatus" s={resumeStatus} />
    </section>
  );
}
