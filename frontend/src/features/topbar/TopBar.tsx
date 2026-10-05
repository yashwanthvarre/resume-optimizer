import { AnimatePresence, motion } from "motion/react";
import { jobProgress, useActivity } from "../../lib/jobs";
import { set, useApp } from "../../store/app";
import { MIN_JD } from "../../store/derive";
import { restart } from "../review/actions";

const STEPS = [["resume", "Resume"], ["jd", "Job"], ["review", "Review"], ["cover", "Cover letter"], ["export", "Download"]] as const;
const STATUS_LBL = { running: "Running", done: "Done", error: "Failed", cancelled: "Cancelled" } as const;

function useSteps() {
  const { view, resume, jdText, exported, cover } = useApp();
  const inReview = view === "review", inCover = view === "cover", past = inReview || inCover;
  const jdOk = jdText.trim().length > MIN_JD, resOk = !!resume;
  const s: Record<string, string> = {
    resume: resOk || past ? "done" : "current",
    jd: jdOk || past ? "done" : resOk ? "current" : "",
    review: inReview ? (exported ? "done" : "current") : inCover ? "done" : "",
    cover: inCover ? (cover ? "done" : "current") : cover ? "done" : "",
    export: exported ? "done" : "",
  };
  if (inCover && cover) s.export = exported ? "done" : "current";
  if (!past && jdOk && !resOk) s.resume = "current";
  if (!past && !jdOk && resOk) s.jd = "current";
  // the current step, else the first one not done yet (e.g. Review, once the resume and job are both in)
  const cur = STEPS.findIndex(([k]) => s[k] === "current"), next = STEPS.findIndex(([k]) => s[k] !== "done");
  const at = cur >= 0 ? cur : next >= 0 ? next : STEPS.length - 1;
  return { s, at };
}

function ActivityPill() {
  const { jobs, open } = useActivity();
  const run = jobs.find((j) => j.status === "running"), last = jobs[0];
  let line = "Idle", full = "Nothing running";
  if (run) {
    const pr = jobProgress(run);
    line = `${pr.current ? pr.current.label : run.title} · ${pr.cur + 1}/${pr.n}`;
    full = `${run.title} — step ${pr.cur + 1} of ${pr.n}${pr.current ? ": " + pr.current.message : ""}`;
  } else if (last) {
    line = STATUS_LBL[last.status];
    full = `Last: ${last.title} — ${STATUS_LBL[last.status].toLowerCase()}`;
  }
  const failed = !run && last?.status === "error";
  return (
    <motion.button id="actToggle" type="button" whileTap={{ scale: 0.96 }} aria-controls="activity" aria-expanded={open} title={full}
      onClick={() => useActivity.setState({ open: !open })}
      className={`btn inline-flex max-w-[150px] items-center gap-2 border !border-line !bg-paper px-3 py-[5px] text-[12.5px] font-medium hover:!bg-sunk sm:max-w-[260px] ${
        run ? "!text-accent !border-[color-mix(in_srgb,var(--color-accent)_35%,var(--color-line))]" : failed ? "!text-rose" : "!text-ink-2"}`}>
      <span aria-hidden="true" className={`size-[7px] flex-none rounded-full ${run ? "breathe bg-accent" : failed ? "bg-rose" : "bg-line-strong"}`} />
      <span className="relative overflow-hidden text-ellipsis">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span id="actNow" key={line} className="block truncate" initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0 }} transition={{ duration: 0.2 }}>{line}</motion.span>
        </AnimatePresence>
      </span>
    </motion.button>
  );
}

export function TopBar() {
  const view = useApp((x) => x.view);
  const { s, at } = useSteps();
  return (
    <header className="topbar sticky top-0 z-20 flex h-[var(--topbar-h)] items-center justify-between gap-2 border-b border-line px-3 sm:gap-3 sm:px-5">
      <div className="flex flex-none items-center gap-2.5 font-[650]">
        <motion.span aria-hidden="true" className="grid size-7 place-items-center rounded-lg bg-accent text-sm font-bold text-white"
          initial={{ rotate: -12, scale: 0.8 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 15 }}>R</motion.span>
        <span className="hidden text-base sm:inline">Resume Optimizer</span>
      </div>
      {/* the step list is read by screen readers; the short line is what's shown */}
      <ol className="sr-only" id="stepper" aria-label="Progress">
        {STEPS.map(([k, label]) => <li key={k} data-step={k} className={s[k]} aria-current={s[k] === "current" ? "step" : undefined}>{label}</li>)}
      </ol>
      <div className="min-w-0 truncate text-[13px] font-medium text-ink-2" id="stepCompact" aria-hidden="true">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={at} className="inline-block" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
            {STEPS[at][1]} · {at + 1} of {STEPS.length}
          </motion.span>
        </AnimatePresence>
      </div>
      <div className="flex flex-none items-center gap-1.5">
        <ActivityPill />
        {view !== "setup" && <button type="button" className="btn ghost sm" id="restartBtn" onClick={restart}>New job</button>}
        <motion.button type="button" className="btn ghost icon" id="settingsBtn" title="Settings" aria-label="Settings"
          whileHover={{ rotate: 45 }} transition={{ type: "spring", stiffness: 300, damping: 14 }} onClick={() => set({ settingsOpen: true })}>⚙</motion.button>
      </div>
    </header>
  );
}
