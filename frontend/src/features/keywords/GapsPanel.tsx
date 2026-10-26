import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAutosize } from "../../hooks/useAutosize";
import { set, useApp, type AppState } from "../../store/app";
import { gapOf, gapReady, gapReason, gapStatus, gapTerms, kwForTerm, roleOptions } from "../../store/derive";
import { hasLoose } from "../../lib/keywords";
import { ClaudeIcon } from "../../ui/ClaudeIcon";
import { Collapse } from "../../ui/Collapse";
import { Seg } from "../../ui/Seg";
import { Sheet } from "../../ui/Sheet";
import { StatusLine } from "../../ui/StatusLine";
import { acceptGapEdit, closeSheet, skipAll, stopAsk, stopGaps, submitAsk, submitGaps, updateGap } from "./actions";

/** Any change in the user's own words: Claude edits the lines it's about, and they land on the page. */
function AskBox() {
  const { askText: ask, askJob: job, askStatus, askReply: reply } = useApp();
  const ref = useAutosize(ask), busy = !!job;
  return (
    <div id="askBox" className="mx-5 mt-3 grid gap-2 rounded-card border border-line bg-paper p-3">
      <label htmlFor="askText" className="flex items-center gap-1.5 text-[13px] font-semibold">
        <span className="text-claude"><ClaudeIcon size={14} /></span>Ask Claude to change something
      </label>
      <textarea ref={ref} id="askText" className="field resize-none overflow-hidden" rows={2} value={ask} disabled={busy}
        placeholder="e.g. mention I led the Postgres migration at Acme, or make the summary shorter"
        onChange={(e) => set({ askText: e.target.value })}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submitAsk(); } }} />
      <div className="flex flex-wrap items-center gap-1.5">
        {busy ? <button type="button" className="btn secondary sm" id="askStop" onClick={stopAsk}>Stop</button>
          : <button type="button" className="btn sm" id="askGo" disabled={!ask.trim()} onClick={() => void submitAsk()}>Make the change</button>}
        <StatusLine s={askStatus} className="!m-0" />
      </div>
      <AnimatePresence>
        {reply && !busy && (
          <motion.p id="askReply" className="small muted" aria-live="polite" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{reply}</motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function NoteBox({ term, i, note, role, roles }: { term: string; i: number; note: string; role: string; roles: string[] }) {
  const ref = useAutosize(note);
  return (
    <div className="grid gap-1.5">
      <label className="label !mt-1 !mb-0" htmlFor={`gapNote${i}`}>Anything Claude should know? (optional)</label>
      <textarea ref={ref} id={`gapNote${i}`} className="field resize-none overflow-hidden" rows={1} data-note
        placeholder="e.g. used it for the billing dashboard at Acme" value={note} onChange={(e) => updateGap(term, { note: e.target.value })} />
      <select className="field" aria-label="Which role was this in? (optional)" value={role} onChange={(e) => updateGap(term, { role: e.target.value })}>
        <option value="">Claude picks the role</option>
        {roles.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
    </div>
  );
}

function GapRow({ s, term, i, roles, flash }: { s: AppState; term: string; i: number; roles: string[]; flash: number }) {
  const k = kwForTerm(s.kws, term), g = gapOf(s, term), status = gapStatus(s, term);
  const imp = k ? k.importance || "" : "suggested";
  const reason = k ? gapReason(s, k) : { text: "Claude suggested this as worth adding." };
  const skipped = g.choice === "skip";
  const head = (
    <div className="flex flex-wrap items-center gap-2">
      <b className={skipped ? "opacity-55" : ""}>{term}</b>
      {imp === "required" && <span className="text-xs text-[#b58b00]" title="Required">★</span>}
      <span className="text-xs text-ink-3 capitalize">{imp}</span>
      {skipped && <span className="tag ml-auto">Skipped</span>}
    </div>
  );
  const why = skipped ? "Won't be added to your resume." : status === "missed" && g.reply ? g.reply.explanation : reason.text;
  return (
    <motion.div layout data-term={term} className={`gap-row ${status} ${skipped ? "skipped" : ""} grid gap-2 border-b border-line py-3.5 last:border-b-0`}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, backgroundColor: flash ? ["#e4f0f4", "#e4f0f4", "rgba(0,0,0,0)"] : "rgba(0,0,0,0)" }}
      exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, transition: { duration: 0.3 } }}
      transition={{ type: "spring", stiffness: 400, damping: 36, backgroundColor: { duration: 1.6 } }}>
      {head}
      <div className={`small ${status === "missed" ? "text-butter" : "muted"} ${skipped ? "opacity-55" : ""}`}>{why}</div>
      {reason.change ? (
        <button type="button" className="btn secondary sm justify-self-start" onClick={() => acceptGapEdit(reason.change!, term)}>Accept that edit</button>
      ) : (
        <>
          <Seg radio className="justify-self-start" label={`How should Claude handle ${term}?`} value={g.choice}
            onChange={(c) => updateGap(term, { choice: c })}
            options={[{ value: "add", label: "Add it" }, { value: "skip", label: "Skip" }]} />
          <Collapse open={!skipped}><NoteBox term={term} i={i} note={g.note} role={g.role} roles={roles} /></Collapse>
        </>
      )}
    </motion.div>
  );
}

export function GapsPanel() {
  const s = useApp();
  const open = s.sheet === "gaps" && s.view === "review" && !!s.analysis;
  const terms = useMemo(() => (s.analysis ? gapTerms(s) : []), [s]);
  const roles = useMemo(() => roleOptions(s), [s.resume]);
  const running = s.gapsJob?.status === "running";
  const listRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<string[]>([]);

  // opened for particular keywords: scroll to them, focus the first, and flash their rows
  useEffect(() => {
    if (!open) return;
    const { terms: want } = s.gapFocus;
    requestAnimationFrame(() => {
      const rows = [...(listRef.current?.querySelectorAll<HTMLElement>(".gap-row") || [])].filter((r) => want.includes(r.dataset.term!));
      if (rows.length) {
        rows[0].scrollIntoView({ block: "center" });
        ((want.length === 1 && rows[0].querySelector("textarea")) || rows[0].querySelector<HTMLElement>("[role=radio]") || rows[0]).focus?.();
        setFlash(want);
        setTimeout(() => setFlash([]), 1700);
      } else listRef.current?.querySelector<HTMLElement>("[role=radio]")?.focus();
    });
  }, [open, s.gapFocus]);

  if (!s.analysis) return null;
  const ready = terms.filter((t) => gapReady(s, t)), n = ready.length;
  const openTerms = terms.filter((t) => gapOf(s, t).choice !== "skip"), all = n === openTerms.length;
  const allSkipped = terms.length > 0 && !openTerms.length;
  const submitLabel = running ? `Adding ${n} keyword${n === 1 ? "" : "s"}…` : !n ? "Nothing to add"
    : n === 1 ? "Add 1 keyword" : `Add ${all ? "all " : ""}${n} ${all ? "missing " : ""}keywords`;

  // suggestions that don't name a keyword are advice; the rest already appear as rows
  const advice = (s.analysis.suggestions || []).filter((x) => !s.kws.some((k) => hasLoose(k, `${x.text} ${x.reason}`)));

  return (
    <Sheet id="gapsDlg" labelId="gapsTitle" open={open} wide onClose={closeSheet} title="Add missing keywords"
      sub={<><b>Add it</b>: Claude finds the closest work in your resume and works the keyword into that line. Write a note under a keyword to tell Claude where or how you used it. Leave it empty and Claude decides. <b>Skip</b>: leave out keywords that don't fit you.</>}
      top={<>
        <AskBox />
        <AnimatePresence>
          {s.gapsSummary && (
            <motion.div id="gapsSummary" aria-live="polite" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mx-5 mt-3 rounded-ctl bg-sky-bg px-3 py-2 text-[13px] font-semibold text-sky">{s.gapsSummary}</motion.div>
          )}
        </AnimatePresence>
      </>}
      foot={
        <>
          <StatusLine id="gapsStatus" s={s.gapsStatus} />
          <div className="mt-1 flex items-center justify-end gap-2">
            {terms.length > 0 && <button type="button" className="linklike mr-auto" id="gapsSkipAll" disabled={running} onClick={skipAll}>{allSkipped ? "Unskip all" : "Skip all"}</button>}
            <button type="button" className="btn ghost" id="gapsCancel" onClick={() => (running ? stopGaps() : closeSheet())}>{running ? "Stop" : "Close"}</button>
            <motion.button type="button" className="btn" id="gapsSubmit" disabled={!n || running} onClick={() => void submitGaps()} whileTap={{ scale: 0.96 }}>
              {running && <span className="spinner" aria-hidden="true" />}{submitLabel}
            </motion.button>
          </div>
        </>
      }>
      <div id="gapsList" ref={listRef} className="grid">
        <AnimatePresence initial={false}>
          {terms.map((t, i) => <GapRow key={t} s={s} term={t} i={i} roles={roles} flash={flash.includes(t) ? 1 : 0} />)}
        </AnimatePresence>
        {!terms.length && <div className="muted py-5 text-center">{s.gapsSummary ? "Nothing left to add." : "Every keyword from the job is in your resume."}</div>}
      </div>
      {advice.length > 0 && (
        <div id="gapsAdvice" className="mt-3 border-t border-line pt-1 text-[13px]">
          <h4>Also worth considering</h4>
          <ul className="grid list-disc gap-2 pl-[18px]">{advice.map((x) => <li key={x.text}><b>{x.text}</b> <span className="muted">{x.reason}</span></li>)}</ul>
        </div>
      )}
    </Sheet>
  );
}
