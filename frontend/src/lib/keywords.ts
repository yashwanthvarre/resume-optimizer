import type { Keyword } from "../api/types";

export interface Kw extends Keyword {
  rank: number;
  res: RegExp[];
}

/** Simple plurals either way, like resume_io.kw_regex. */
export function kwRegex(term: string) {
  term = term.trim();
  if (/(?:[a-z]{3}[^s\W]|[A-Z]{2})s$/.test(term)) term = term.slice(0, -1);
  const t = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+");
  return new RegExp(`(^|[^A-Za-z0-9])${t}(?:s|es)?(?=$|[^A-Za-z0-9])`, "i");
}

const RANK: Record<string, number> = { required: 0, preferred: 1, nice: 2 };

export function prepKeywords(keywords: Keyword[] = []) {
  const kws: Kw[] = keywords
    .map((k) => ({ ...k, rank: RANK[k.importance ?? ""] ?? 2, res: [k.term, ...(k.variants || [])].filter(Boolean).map(kwRegex) }))
    .sort((a, b) => a.rank - b.rank);
  const all = kws.flatMap((k) => k.res.map((r) => new RegExp(r.source, "gi")));
  return { kws, all };
}

/** Merged [start, end) spans of every JD keyword in text (same matcher as the counts and the download). */
export function kwSpans(text: string, all: RegExp[]) {
  const spans: [number, number][] = [];
  for (const re of all) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) spans.push([m.index + m[1].length, m.index + m[0].length]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of spans) {
    const l = out[out.length - 1];
    if (l && a <= l[1]) l[1] = Math.max(l[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Which JD keywords appear in the text (term, variants, simple plurals). */
export function coverage(text: string, kws: Kw[]) {
  const hit = new Set<string>();
  for (const k of kws) if (k.res.some((r) => r.test(text))) hit.add(k.term);
  return hit;
}

// justified like the download: body text and bullets that wrap; not tab/separator rows or one-liners
const SEP_RE = /\t| {2,}\S| [·|] /;
export function justifyOk(kind: string, raw: string) {
  const t = raw.trim();
  return (kind === "text" || kind === "bullet") && !t.includes("\n") && !SEP_RE.test(t) && t.length >= 90;
}
