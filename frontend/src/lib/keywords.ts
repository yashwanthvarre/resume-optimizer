import type { Keyword } from "../api/types";

export interface Kw extends Keyword {
  rank: number;
  /** the JD's spelling: the only match that counts as present */
  exact: RegExp;
  /** term and variants, ignoring case and . - space */
  loose: RegExp[];
}

const PLURAL = /(?:[a-z]{3}[^s\W]|[A-Z]{2})s$/; // a plural ("pipelines", "APIs"): match the singular too
const ALNUM = /[A-Za-z0-9]/;
const LOOSE_SEP = "[.\\s-]?"; // ".", "-", a space or nothing are all the same in a LOOSE match
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/#-]/g, "\\$&");

/** The term without a simple plural "s": what kwRegex matches before its optional "s"/"es". */
export function kwBase(term: string) {
  term = term.trim();
  return PLURAL.test(term) ? term.slice(0, -1) : term;
}

/** Same as resume_io.kw_regex: whole words, simple plurals either way; groups "k" (the keyword) and "pl".
 * EXACT (default): case-sensitive, character for character; a term that starts lowercase may start with a capital.
 * LOOSE: ignores case and treats ".", "-", a space and nothing as the same ("reactjs" matches "ReactJS"). */
export function kwRegex(term: string, loose = false) {
  const base = kwBase(term);
  let t = "";
  if (!loose) {
    t = esc(base).replace(/ /g, "\\s");
    if (/^[a-z]/.test(base)) t = `[${base[0]}${base[0].toUpperCase()}]${t.slice(1)}`;
  } else {
    let prev = "";
    for (const ch of base) {
      if (ch === "." || ch === "-" || /\s/.test(ch)) {
        if (!t.endsWith(LOOSE_SEP)) t += LOOSE_SEP;
      } else {
        if (ALNUM.test(prev) && ALNUM.test(ch)) t += LOOSE_SEP;
        t += esc(ch);
      }
      prev = ch;
    }
  }
  return new RegExp(`(?:^|(?<=[^A-Za-z0-9]))(?<k>${t}(?<pl>s|es)?)(?=$|[^A-Za-z0-9])`, loose ? "gi" : "g");
}

// text that isn't prose: URLs, email addresses and file paths (github.com/me/java-app, ~/src/app.py)
const NOT_PROSE = new RegExp(
  "[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+" +
  "|\\b(?:https?://|www\\.)\\S+" +
  "|\\b[\\w-]+(?:\\.[\\w-]+)*\\.(?:com|org|net|io|dev|app|ai|co|edu|gov|me|us|uk|ca|de|info|xyz|tech)(?:/\\S*)?(?![\\w-])" +
  "|(?:[A-Za-z]:\\\\|~/|\\.{1,2}/|(?<![\\w/])/(?=[\\w.-]+/))\\S+" +
  "|[\\w.-]+(?:/[\\w.-]+){2,}", "gi");

// ordinary English words that are also tech names: "react to", "go-to-market", "spring" are never React, Go, Spring
const COMMON_WORDS = new Set(`access ant backbone bootstrap chef consul dart elastic ember excel express flask flutter go
  helm hive ionic jest less linear make material meteor mocha nest next notion office outlook pig project puppet
  rails react ruby rust salt sketch slack spark spring storm swift teams unity vault word zoom`.split(/\s+/));
const english = (found: string) => /^[a-z]+$/.test(found) && (found.length === 1 || COMMON_WORDS.has(found));

// a keyword match is all group "k" (the boundary before it is a lookbehind)
const spansOf = (re: RegExp, text: string): [number, number][] => [...text.matchAll(re)].map((m) => [m.index, m.index + m[0].length]);

export interface Loose { start: number; end: number; found: string; pl: string; form: string }

/** Same as resume_io.loose_only: LOOSE matches of the term or a variant that aren't EXACT matches of the term,
 * ordinary lowercase English words, or inside a URL, email address or file path. */
export function looseOnly(text: string, term: string, variants: string[] = []): Loose[] {
  const taken = [...spansOf(kwRegex(term), text), ...spansOf(NOT_PROSE, text)];
  const out: Loose[] = [];
  for (const f of [term, ...variants]) {
    if (!f || !f.trim()) continue;
    for (const m of text.matchAll(kwRegex(f, true))) {
      const found = m[0], start = m.index, end = start + found.length;
      if (english(found) || taken.some(([a, b]) => a < end && start < b)) continue;
      taken.push([start, end]);
      out.push({ start, end, found, pl: m.groups!.pl ?? "", form: f });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

const RANK: Record<string, number> = { required: 0, preferred: 1, nice: 2 };

export function prepKeywords(keywords: Keyword[] = []) {
  const kws: Kw[] = keywords
    .map((k) => ({ ...k, rank: RANK[k.importance ?? ""] ?? 2, exact: kwRegex(k.term), loose: [k.term, ...(k.variants || [])].filter(Boolean).map((t) => kwRegex(t, true)) }))
    .sort((a, b) => a.rank - b.rank);
  const all = kws.map((k) => k.exact);
  return { kws, all };
}

/** Merged [start, end) spans of every EXACT JD keyword match in text (same matcher as the counts and the download). */
export function kwSpans(text: string, all: RegExp[]) {
  const spans = all.flatMap((re) => spansOf(re, text));
  spans.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of spans) {
    const l = out[out.length - 1];
    if (l && a <= l[1]) l[1] = Math.max(l[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Does the text have the JD's exact spelling of the keyword (simple plurals allowed)? */
export const hasExact = (k: Pick<Kw, "exact">, text: string) => { k.exact.lastIndex = 0; return k.exact.test(text); };

/** Does the text name the keyword in any spelling (term or variant)? */
export const hasLoose = (k: Pick<Kw, "loose">, text: string) => k.loose.some((r) => { r.lastIndex = 0; return r.test(text); });

/** Which JD keywords appear in the text: only an EXACT match counts. */
export function coverage(text: string, kws: Kw[]) {
  const hit = new Set<string>();
  for (const k of kws) if (hasExact(k, text)) hit.add(k.term);
  return hit;
}

/** Keywords the text has only in another spelling, with the text's spellings ("java" for "Java"). */
export function misspelled(text: string, kws: Kw[]) {
  const out = new Map<string, string[]>();
  for (const k of kws) {
    if (hasExact(k, text)) continue;
    const found = [...new Set(looseOnly(text, k.term, k.variants).map((x) => x.found))];
    if (found.length) out.set(k.term, found);
  }
  return out;
}

// justified like the download: body text and bullets that wrap; not tab/separator rows or one-liners
const SEP_RE = /\t| {2,}\S| [·|] /;
export function justifyOk(kind: string, raw: string) {
  const t = raw.trim();
  return (kind === "text" || kind === "bullet") && !t.includes("\n") && !SEP_RE.test(t) && t.length >= 90;
}
