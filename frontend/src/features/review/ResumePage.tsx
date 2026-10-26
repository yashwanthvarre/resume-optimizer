import { memo, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { insertedSpans } from "../../lib/diff";
import { justifyOk, kwRegex, kwSpans } from "../../lib/keywords";
import { useApp } from "../../store/app";
import { changeText, matchesFilter, splitLines } from "../../store/derive";
import { ClaudeIcon } from "../../ui/ClaudeIcon";
import { openPop } from "./actions";
import { openRefine } from "./refine";

const norm = (t: string) => t.replace(/\t+/g, "   ").replace(/^\s+/, ""); // tabs as spaces; drop e.g. a leading column break

/** text[x, y) with the keywords in it bold. */
function bold(text: string, spans: [number, number][], x = 0, y = text.length): ReactNode[] {
  const out: ReactNode[] = [];
  let at = x;
  for (const [a0, b0] of spans) {
    const a = Math.max(a0, x), b = Math.min(b0, y);
    if (a >= b) continue;
    out.push(text.slice(at, a), <strong key={a}>{text.slice(a, b)}</strong>);
    at = b;
  }
  out.push(text.slice(at, y));
  return out;
}

type Mark = [number, number, "ins" | "kw"];

/** What the edit wrote into this line: every inserted run ("ins"), and the keywords it was made for that land in one
 *  ("kw", stronger). A new bullet is all new. */
function changeMarks(text: string, from: string | null, terms: string[]): Mark[] {
  const ins = from === null ? [[0, text.length] as [number, number]] : insertedSpans(from, text);
  const kw = terms.flatMap((t) => [...text.matchAll(kwRegex(t))].map((m): [number, number] => [m.index, m.index + m[0].length]))
    .filter(([a, b]) => ins.some(([x, y]) => x < b && a < y));
  const cuts = [...new Set([...ins, ...kw].flat())].sort((a, b) => a - b), out: Mark[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1], inside = (s: [number, number][]) => s.some(([x, y]) => x <= a && b <= y);
    const k = inside(kw) ? "kw" : inside(ins) ? "ins" : null, l = out[out.length - 1];
    if (!k) continue;
    if (l && l[1] === a && l[2] === k) l[1] = b;
    else out.push([a, b, k]);
  }
  return out;
}

/** The page text: keywords bold, and (on an accepted edit) its changes highlighted, each touching run of them a group
 *  that ends in the Ask-Claude button. Highlights and buttons are screen-only. */
function render(text: string, boldAll: RegExp[] | null, marks: Mark[], id: string, ask?: { change: string; line: number }): ReactNode {
  const spans = boldAll ? kwSpans(text, boldAll) : [];
  if (!marks.length) return bold(text, spans);
  const out: ReactNode[] = [];
  let at = 0, g = 0;
  for (let i = 0; i < marks.length; ) {
    let j = i;
    while (j + 1 < marks.length && marks[j + 1][0] === marks[j][1]) j++;
    const a = marks[i][0], b = marks[j][1], gid = `mk-${id}-${g}`;
    out.push(...bold(text, spans, at, a));
    out.push(
      <span key={gid} id={gid} className="chg-grp">
        {marks.slice(i, j + 1).map(([x, y, k]) => <mark key={x} className={`chg ${k}`}>{bold(text, spans, x, y)}</mark>)}
        {ask && (
          <span className="ask-at no-print">
            <button type="button" className="ask" tabIndex={g ? -1 : 0} aria-label="Ask Claude to rewrite this" title="Ask Claude to rewrite this"
              data-ask={ask.change} data-line={ask.line} data-anchor={gid}><ClaudeIcon size={13} /></button>
          </span>
        )}
      </span>,
    );
    at = b; g++; i = j + 1;
  }
  out.push(...bold(text, spans, at));
  return out;
}

const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

interface ParaProps {
  id: string; cls: string; text: string; boldOn: boolean; kwAll: RegExp[];
  changeId?: string; label?: string; flashAdded: number;
  /** highlight what the edit changed: 0 no, 1 against `from`, 2 all of it (a new bullet) */
  hl: 0 | 1 | 2; from: string; hlKw: string; line: number;
}

/** One paragraph of the page. A change in its text flashes it; an edit Claude just added glows lilac. */
const Para = memo(function Para({ id, cls, text, boldOn, kwAll, changeId, label, flashAdded, hl, from, hlKw, line }: ParaProps) {
  const ref = useRef<HTMLDivElement>(null), prev = useRef(text);
  useEffect(() => {
    if (prev.current === text) return;
    prev.current = text;
    if (!reduce()) ref.current?.animate([{ backgroundColor: "#e7f0fa" }, { backgroundColor: "transparent" }], { duration: 1000, easing: "cubic-bezier(.2,.7,.2,1)" });
  }, [text]);
  useLayoutEffect(() => {
    if (!flashAdded || reduce()) return;
    ref.current?.animate([
      { backgroundColor: "#f1ebfa", boxShadow: "-3px 0 0 #6a4a9c" }, { backgroundColor: "#f1ebfa", boxShadow: "-3px 0 0 #6a4a9c", offset: 0.6 },
      { backgroundColor: "transparent", boxShadow: "-3px 0 0 transparent" }], { duration: 2200, easing: "ease-out" });
  }, [flashAdded]);
  const edit = !!changeId;
  const body = useMemo(() => {
    const marks = hl ? changeMarks(text, hl === 2 ? null : from, hlKw ? hlKw.split("\n") : []) : [];
    return render(text, boldOn ? kwAll : null, marks, id, changeId ? { change: changeId, line } : undefined);
  }, [text, boldOn, kwAll, hl, from, hlKw, id, changeId, line]);
  return (
    <div ref={ref} className={cls} id={`pp-${id}`}
      {...(edit ? { "data-change": changeId, tabIndex: 0, role: "button", "aria-label": label } : {})}>
      {body}
    </div>
  );
});

/** The page shows the final text as it will download: keywords bold, body justified. Review cues (a left rule on edits,
 *  a dotted underline on skipped ones, the current edit) are screen-only. */
export function ResumePage() {
  const s = useApp();
  const { resume, analysis, selected, pop, showMarks, cfg, kwAll, addedNow } = s;
  const boldOn = cfg?.bold_keywords !== false;
  const byTarget = useMemo(() => Object.fromEntries((analysis?.changes || []).map((c) => [c.target_id, c])), [analysis]);
  if (!resume || !analysis) return null;

  let first = true, body = false;
  const paras = resume.paragraphs.map((p) => {
    const c = byTarget[p.id], blank = !p.text.trim();
    if (p.kind === "heading") body = true;
    const on = !!c && selected.has(c.id), raw = c ? (on ? changeText(s, c) : c.original_text) : p.text;
    const isBody = body && p.kind !== "heading", wasFirst = first && !blank;
    if (!blank) first = false;
    let mark = "", label: string | undefined;
    if (c) {
      mark = ` edit ${on ? "on" : "off"}${matchesFilter(s, c) ? " marked" : ""}${showMarks ? "" : " quiet"}${(c.warnings || []).length ? " flagged" : ""}${pop === c.id ? " current" : ""}`;
      label = `${on ? "Accepted" : "Skipped"} edit: ${c.reason}`;
    }
    const hl = !!c && on && showMarks, from = splitLines(p.kind, p.text, p.text)[0], hlKw = (c?.jd_keywords || []).join("\n");
    return splitLines(p.kind, p.text, raw).map((line, n) => {
      const cls = `pp ${p.kind}` + (wasFirst && !n ? " first" : "") + (isBody && justifyOk(p.kind, line) ? " just" : "") + mark;
      const id = n ? `${p.id}-${n}` : p.id;
      return <Para key={id} id={id} cls={cls} text={norm(line)} boldOn={isBody && boldOn} kwAll={kwAll} changeId={c?.id} label={label}
        flashAdded={c && addedNow.ids.includes(c.id) ? addedNow.at : 0} hl={hl ? (n ? 2 : 1) : 0} from={hl && !n ? norm(from) : ""} hlKw={hl ? hlKw : ""} line={n} />;
    });
  });

  return (
    <article className="page" id="preview" aria-label="Your resume with suggested edits"
      onClick={(e) => {
        const ask = (e.target as HTMLElement).closest<HTMLElement>(".ask");
        if (ask?.dataset.ask) return openRefine(ask.dataset.ask, Number(ask.dataset.line), ask.dataset.anchor!);
        const el = (e.target as HTMLElement).closest<HTMLElement>(".edit");
        if (el?.dataset.change) openPop(el.dataset.change);
      }}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest(".ask")) return; // the button's own Enter / Space
        const el = (e.target as HTMLElement).closest<HTMLElement>(".edit");
        if (el?.dataset.change && (e.key === "Enter" || (e.key === " " && pop !== el.dataset.change))) { e.preventDefault(); openPop(el.dataset.change); }
      }}>
      {paras}
    </article>
  );
}
