import { memo, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { justifyOk, kwSpans } from "../../lib/keywords";
import { useApp } from "../../store/app";
import { changeText, matchesFilter } from "../../store/derive";
import { openPop } from "./actions";

const norm = (t: string) => t.replace(/\t+/g, "   ").replace(/^\s+/, ""); // tabs as spaces; drop e.g. a leading column break

function bold(text: string, all: RegExp[]): ReactNode {
  const out: ReactNode[] = [];
  let at = 0;
  for (const [a, b] of kwSpans(text, all)) {
    out.push(text.slice(at, a), <strong key={a}>{text.slice(a, b)}</strong>);
    at = b;
  }
  out.push(text.slice(at));
  return out;
}

/** A bullet's edited text can end with new bullets, one per extra line; line breaks it already had stay in it. */
function splitNew(kind: string, orig: string, raw: string): string[] {
  if (kind !== "bullet") return [raw];
  const lines = raw.split("\n"), keep = orig.split("\n").length;
  return [lines.slice(0, keep).join("\n"), ...lines.slice(keep).filter((t) => t.trim())];
}

const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

interface ParaProps {
  id: string; cls: string; text: string; boldOn: boolean; kwAll: RegExp[];
  changeId?: string; label?: string; flashAdded: number;
}

/** One paragraph of the page. A change in its text flashes it; an edit Claude just added glows lilac. */
const Para = memo(function Para({ id, cls, text, boldOn, kwAll, changeId, label, flashAdded }: ParaProps) {
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
  return (
    <div ref={ref} className={cls} id={`pp-${id}`}
      {...(edit ? { "data-change": changeId, tabIndex: 0, role: "button", "aria-label": label } : {})}>
      {boldOn ? bold(text, kwAll) : text}
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
    return splitNew(p.kind, p.text, raw).map((line, n) => {
      const cls = `pp ${p.kind}` + (wasFirst && !n ? " first" : "") + (isBody && justifyOk(p.kind, line) ? " just" : "") + mark;
      const id = n ? `${p.id}-${n}` : p.id;
      return <Para key={id} id={id} cls={cls} text={norm(line)} boldOn={isBody && boldOn} kwAll={kwAll} changeId={c?.id} label={label}
        flashAdded={c && addedNow.ids.includes(c.id) ? addedNow.at : 0} />;
    });
  });

  return (
    <article className="page" id="preview" aria-label="Your resume with suggested edits"
      onClick={(e) => { const el = (e.target as HTMLElement).closest<HTMLElement>(".edit"); if (el?.dataset.change) openPop(el.dataset.change); }}
      onKeyDown={(e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>(".edit");
        if (el?.dataset.change && (e.key === "Enter" || (e.key === " " && pop !== el.dataset.change))) { e.preventDefault(); openPop(el.dataset.change); }
      }}>
      {paras}
    </article>
  );
}
