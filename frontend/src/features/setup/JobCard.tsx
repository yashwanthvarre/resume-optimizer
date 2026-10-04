import { useApp, set } from "../../store/app";
import { MIN_JD } from "../../store/derive";
import { Collapse } from "../../ui/Collapse";
import { StatusLine } from "../../ui/StatusLine";
import { StepNo } from "./StepNo";
import { fetchJd, scheduleFetch, showPasteBox } from "./actions";

export function JobCard() {
  const { jdUrl, jdText, jdBox, jdTitle, jdMethod, jdStatus, fetching, fetchRetry, finderTab } = useApp();
  const n = jdText.trim().length, ok = n > MIN_JD && !fetching;
  return (
    <section className={`card ${n > MIN_JD ? "complete" : ""}`} id="jdCard">
      <div className="mb-1 flex items-center gap-2.5"><StepNo n={finderTab ? 2 : 3} done={n > MIN_JD} id="jdStepNo" /><h2>The job</h2></div>
      {!finderTab && <p className="hint" id="jdHint">Pick one of the jobs above, or add one yourself here.</p>}
      <label className="label" htmlFor="jdUrl">Job posting link</label>
      <div className="flex items-center gap-2">
        <input id="jdUrl" className="field" type="url" placeholder="Workday, LinkedIn, Greenhouse, Lever…" value={jdUrl}
          onChange={(e) => { set({ jdUrl: e.target.value }); scheduleFetch(); }}
          onPaste={() => setTimeout(() => void fetchJd(), 0)}
          onBlur={() => void fetchJd()}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void fetchJd(fetchRetry); } }} />
        <button type="button" className="btn secondary" id="fetchBtn" disabled={fetching} onClick={() => void fetchJd(true)}>{fetchRetry ? "Retry" : "Fetch"}</button>
      </div>
      <button type="button" className="linklike mt-2.5" id="pasteLink" onClick={() => { showPasteBox(); setTimeout(() => document.getElementById("jdText")?.focus(), 60); }}>
        Or paste the job description
      </button>
      <StatusLine id="jdStatus" s={jdStatus} />
      <Collapse open={jdBox} id="jdBox">
        <div className="mt-3.5 mb-2 flex flex-wrap items-center gap-2"><strong id="jdTitle">{jdTitle}</strong>{jdMethod && <span id="jdMethod" className="tag">{jdMethod}</span>}</div>
        <textarea id="jdText" className="field" rows={9} placeholder="Paste the full job description here…" value={jdText} onChange={(e) => set({ jdText: e.target.value })} />
        <div className="flex items-baseline justify-between gap-2.5">
          <span className="hint">Check this is the right job. You can edit the text.</span>
          <span id="jdCounter" className={`mt-1.5 text-xs tabular-nums whitespace-nowrap ${n > 0 && !ok ? "text-butter" : "text-ink-2"}`}>
            {n ? `${n.toLocaleString()} characters${!ok ? " · a bit short" : ""}` : ""}
          </span>
        </div>
      </Collapse>
    </section>
  );
}
