import { motion } from "motion/react";
import { cancelJob } from "../../lib/jobs";
import { useApp } from "../../store/app";
import { StatusLine } from "../../ui/StatusLine";
import { StepNo } from "./StepNo";
import { findJobs, openOneJob, tailorAll } from "./actions";

const ago = (min: number) => min < 1 ? "just now" : min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""} ago`;

export function FindJobsCard() {
  const { found, foundAt, findStatus, findRunning, findJob, hasSearched, resume, opened } = useApp();
  const since = Math.round((Date.now() - foundAt) / 60000);
  const jobs = found?.jobs || [];
  return (
    <section className={`card ${found ? "complete" : ""}`} id="findCard">
      <div className="mb-1 flex items-center gap-2.5"><StepNo n={2} done={false} /><h2>Jobs Claude found for you</h2></div>
      <p className="hint">As soon as your resume is loaded, Claude searches the web for postings that fit it and were posted in the last 2 hours.
        Each job you pick opens in its own tab, with its own resume and cover letter.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 empty:hidden">
        {hasSearched && !findRunning && <button type="button" className="btn secondary" id="findJobsBtn" disabled={!resume} onClick={() => void findJobs()}>Search again</button>}
        {findRunning && <button type="button" className="btn ghost sm" id="findCancel" onClick={() => cancelJob(findJob)}>Cancel</button>}
      </div>
      <StatusLine id="findStatus" s={findStatus} />
      {findRunning && <SearchShimmer />}
      {/* old results vanish at once when a new search starts (no exit animation: they mustn't stay clickable) */}
      {jobs.length > 0 && (
          <motion.div id="findResults" key={foundAt} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <motion.ol id="jobList" className="mt-3.5 grid list-none gap-2.5 p-0" initial="hide" animate="show"
              variants={{ show: { transition: { staggerChildren: 0.07 } } }}>
              {jobs.map((j, i) => {
                const isOpen = opened.includes(i);
                return (
                  <motion.li key={j.url} data-i={i} variants={{ hide: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } } }}
                    className={`job transition-[box-shadow,border-color] duration-200 hover:shadow-[0_6px_18px_rgba(31,35,40,.08)] hover:border-line-strong grid grid-cols-1 items-start gap-x-3.5 gap-y-1.5 rounded-ctl border bg-canvas px-3.5 py-3 sm:grid-cols-[1fr_auto] ${isOpen ? "opened border-sage" : "border-line"}`}>
                    <div>
                      <div className="font-semibold [overflow-wrap:anywhere]">
                        <a href={j.url} target="_blank" rel="noopener" className="!text-inherit no-underline hover:underline hover:underline-offset-[3px]">{j.title}</a>
                      </div>
                      <div className="text-[12.5px] text-ink-2 [overflow-wrap:anywhere]">
                        {[j.company, j.location, `posted ${ago(j.age_minutes + since)}`, j.source].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <motion.button type="button" whileTap={{ scale: 0.95 }} className={`btn sm justify-self-start ${isOpen ? "secondary" : ""}`} data-open={i}
                      onClick={() => openOneJob(i)}>
                      {isOpen ? "Opened in a new tab ↗" : "Tailor resume + cover letter"}
                    </motion.button>
                    {j.match_reason && <div className="text-[13px] text-ink-2 sm:col-span-2">{j.match_reason}</div>}
                  </motion.li>
                );
              })}
            </motion.ol>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" className="btn secondary sm" id="tailorAll" onClick={tailorAll}>Tailor all {jobs.length} in new tabs</button>
              <span className="hint !m-0">If only one tab opens, allow pop-ups for this page.</span>
            </div>
          </motion.div>
      )}
    </section>
  );
}

/** Placeholder rows while the search runs. */
function SearchShimmer() {
  return (
    <div className="mt-3.5 grid gap-2.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <motion.div key={i} className="h-[62px] rounded-ctl border border-line bg-canvas"
          initial={{ opacity: 0.35 }} animate={{ opacity: [0.35, 0.8, 0.35] }} transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.2 }} />
      ))}
    </div>
  );
}
