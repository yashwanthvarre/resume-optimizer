import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { Job } from "../../api/types";
import { useNow } from "../../hooks/useNow";
import { cancelJob, fmtDur, jobProgress, useActivity, type StepView } from "../../lib/jobs";
import { Sheet } from "../../ui/Sheet";

const STATUS_LBL = { running: "Running", done: "Done", error: "Failed", cancelled: "Cancelled" } as const;
const BADGE = { running: "bg-accent-soft text-accent", done: "bg-sage-bg text-sage", error: "bg-rose-bg text-rose", cancelled: "bg-sunk text-ink-2" } as const;

function Step({ st, last, t }: { st: StepView; last: boolean; t: number }) {
  const more = [...st.log.slice(0, -1), ...([] as unknown[]).concat(st.detail ?? [])];
  const ico = { pending: "border-line-strong", running: "border-accent", done: "bg-sage border-sage", error: "bg-rose border-rose" }[st.status];
  return (
    <li className={`st ${st.status} relative grid grid-cols-[16px_1fr_auto] items-start gap-2.5 py-[5px]`}>
      {!last && <span aria-hidden="true" className="absolute top-6 -bottom-[3px] left-[7.5px] w-px bg-line" />}
      <motion.span aria-hidden="true" layout className={`mt-0.5 grid size-4 place-items-center rounded-full border-[1.5px] text-[9px] font-extrabold text-white ${ico}`}
        initial={false} animate={{ scale: st.status === "done" || st.status === "error" ? [1.25, 1] : 1 }} transition={{ duration: 0.3 }}>
        {st.status === "running" ? <span className="spinner !m-0 !size-[9px] text-accent" /> : st.status === "done" ? "✓" : st.status === "error" ? "✕" : ""}
      </motion.span>
      <div className="min-w-0">
        <div className={`text-[13px] font-semibold ${st.status === "pending" ? "text-ink-2" : "text-ink"}`}>{st.label}<span className="sr-only"> — {st.status}</span></div>
        {st.message && <div className={`text-[12.5px] [overflow-wrap:anywhere] ${st.status === "error" ? "text-rose" : "text-ink-2"}`}>{st.message}</div>}
        {more.length > 0 && (
          <details className="mt-[3px] text-xs">
            <summary className="cursor-pointer text-accent">Details ({more.length})</summary>
            <ul className="mt-1 max-h-[200px] list-disc overflow-auto pl-4 text-ink-2">
              {more.map((x, i) => <li key={i}>{typeof x === "string" ? x : JSON.stringify(x)}</li>)}
            </ul>
          </details>
        )}
      </div>
      {st.t0 != null && <span className="text-xs tabular-nums whitespace-nowrap text-ink-3">{fmtDur((st.t1 ?? t) - st.t0)}</span>}
    </li>
  );
}

function JobCard({ job, t }: { job: Job; t: number }) {
  const { steps } = jobProgress(job);
  const [cancelling, setCancelling] = useState(false);
  const border = job.status === "running" ? "border-[color-mix(in_srgb,var(--color-accent)_40%,var(--color-line))]"
    : job.status === "error" ? "border-[color-mix(in_srgb,var(--color-rose)_35%,var(--color-line))]" : "border-line";
  return (
    <motion.section layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 400, damping: 34 }}
      className={`act-job ${job.status} rounded-card border px-3.5 py-3 ${border} ${job.status === "error" || job.status === "cancelled" ? "[&_.st.pending]:opacity-50" : ""}`}>
      <header className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE[job.status]}`}>{STATUS_LBL[job.status]}</span>
        <strong className="min-w-0 flex-1 text-[13.5px] font-semibold">{job.title}</strong>
        <span className="text-xs tabular-nums text-ink-3">{fmtDur((job.t1 ?? t) - job.t0)}</span>
        {job.status === "running" && !job.local && (
          <button type="button" className="btn ghost sm !text-rose" disabled={cancelling} onClick={() => { setCancelling(true); cancelJob(job); }}>
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
        )}
      </header>
      <ol className="mt-2.5 grid list-none p-0">
        {steps.map((x, i) => <Step key={x.step} st={x} last={i === steps.length - 1} t={t} />)}
      </ol>
      {job.error && job.status === "error" && (
        <div className="mt-2 rounded-ctl bg-rose-bg px-2.5 py-[7px] text-[12.5px] text-rose [overflow-wrap:anywhere]">{job.error}</div>
      )}
    </motion.section>
  );
}

export function ActivityPanel() {
  const { jobs, open, live } = useActivity();
  const t = useNow(open && jobs.some((j) => j.status === "running"));
  const close = () => { useActivity.setState({ open: false }); document.getElementById("actToggle")?.focus(); };
  return (
    <>
      <Sheet id="activity" labelId="actTitle" open={open} onClose={close} title="Activity" sub="Each step the app takes, as it happens.">
        <div id="actList" className="grid gap-2.5">
          <AnimatePresence initial={false}>
            {jobs.length ? jobs.map((j) => <JobCard key={j.job_id} job={j} t={t} />)
              : <div className="muted small py-4">Nothing yet. Fetching a job, analyzing, writing the cover letter and downloading all show up here, step by step.</div>}
          </AnimatePresence>
        </div>
      </Sheet>
      <div className="sr-only" id="actLive" aria-live="polite">{live}</div>
    </>
  );
}
