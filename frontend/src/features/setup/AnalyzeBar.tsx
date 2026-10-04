import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useNow } from "../../hooks/useNow";
import { fmtDur, jobProgress, useActivity } from "../../lib/jobs";
import { useApp } from "../../store/app";
import { jdOk } from "../../store/derive";
import { StatusLine } from "../../ui/StatusLine";
import { analyze, cancelAnalyze } from "./analyze";

function Progress() {
  const job = useApp((s) => s.analyzeJob);
  const [cancelling, setCancelling] = useState(false);
  const t = useNow(!!job && job.status === "running");
  if (!job) return <div className="h-[118px]" />;
  const { steps, n, done, current } = jobProgress(job);
  const pct = job.status === "done" ? 100 : Math.max(4, (100 * (done + (current ? 0.5 : 0))) / n);
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <AnimatePresence mode="wait" initial={false}>
          <motion.strong id="progressStage" key={current?.step || job.status} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6 }} transition={{ duration: 0.18 }}>
            {job.status === "done" ? "Done" : current ? current.message + "…" : "Starting…"}
          </motion.strong>
        </AnimatePresence>
        <span className="muted small tabular-nums" id="progressTime">{fmtDur((job.t1 ?? t) - job.t0)}</span>
      </div>
      <div className="my-3 h-1 overflow-hidden rounded-full bg-sunk">
        <motion.div id="progressFill" className="relative h-full overflow-hidden rounded-full bg-accent" initial={{ width: 0 }} animate={{ width: `${pct}%` }}
          transition={{ type: "spring", stiffness: 60, damping: 18 }}>
          <motion.span className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/45 to-transparent"
            animate={{ x: ["-100%", "300%"] }} transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }} />
        </motion.div>
      </div>
      <ol className="grid list-none gap-1.5 p-0 text-[13.5px]" id="progressStages">
        {steps.map((x) => {
          const dot = { running: "bg-accent breathe", done: "bg-sage", error: "bg-rose", pending: "bg-line-strong" }[x.status];
          return (
            <motion.li key={x.step} layout className={`flex items-center gap-2.5 ${
              x.status === "running" ? "active font-semibold text-ink" : x.status === "done" ? "done text-ink-2" : x.status === "error" ? "text-rose" : "text-ink-3"}`}>
              <motion.span className={`size-2 flex-none rounded-full ${dot}`} animate={{ scale: x.status === "done" ? [1.6, 1] : 1 }} />
              <span>{x.label}{x.message && x.status !== "pending" && <span className="font-normal text-ink-2"> — {x.message}</span>}</span>
            </motion.li>
          );
        })}
      </ol>
      <div className="mt-2.5 flex justify-end gap-1">
        <button type="button" className="btn ghost sm" id="progressDetails" onClick={() => useActivity.setState({ open: true })}>Details</button>
        {job.status === "running" && (
          <button type="button" className="btn ghost sm" id="progressCancel" disabled={cancelling} onClick={() => { setCancelling(true); cancelAnalyze(); }}>
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
        )}
      </div>
    </>
  );
}

export function AnalyzeBar() {
  const s = useApp();
  const ready = !!s.resume && jdOk(s);
  const need: string[] = [];
  if (!s.resume) need.push("your resume");
  if (!jdOk(s)) need.push(s.resume ? "a job (pick one above or add your own)" : "a job");
  return (
    <div className="mt-1.5 grid justify-items-center gap-2 text-center">
      <motion.button id="analyzeBtn" type="button" className="btn big" disabled={!ready || s.analyzing} onClick={() => void analyze()}
        animate={ready && !s.analyzing ? { scale: [1, 1.04, 1] } : { scale: 1 }} transition={{ duration: 0.5 }}
        whileHover={ready ? { y: -1 } : undefined} whileTap={ready ? { scale: 0.97 } : undefined}>
        Analyze and suggest edits
      </motion.button>
      <div className="muted small" id="analyzeNeed">{s.analyzing ? "" : need.length ? `Add ${need.join(" and ")} to continue.` : "Ready when you are."}</div>
      <AnimatePresence>
        {s.progressShown && (
          <motion.div id="progress" className="w-full rounded-card border border-line bg-paper px-[18px] py-4 text-left"
            initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}>
            <Progress />
          </motion.div>
        )}
      </AnimatePresence>
      <StatusLine id="analyzeStatus" s={s.analyzeStatus} />
    </div>
  );
}
