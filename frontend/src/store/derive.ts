// Pure helpers over the app state, shared by the review page, keyword panels, cover letter and downloads.
import type { Change, Edit } from "../api/types";
import { coverage, hasExact, misspelled, type Kw } from "../lib/keywords";
import type { AppState, DlFormat, Gap } from "./app";

type S = Pick<AppState, "analysis" | "resume" | "selected" | "edits">;

export const NS = "Not specified";
export const roleLine = (s: Pick<AppState, "analysis">, sep = " · ") =>
  [s.analysis?.jd.role, s.analysis?.jd.company].filter((x) => x && x !== NS).join(sep);
export const tabLabel = (s: Pick<AppState, "analysis">) =>
  [s.analysis?.jd.company, s.analysis?.jd.role].filter((x) => x && x !== NS).join(" – ");

export const changeText = (s: Pick<AppState, "edits">, c: Change) => s.edits[c.id] ?? c.new_text;

/** A bullet's edited text can end with new bullets, one per extra line; line breaks it already had stay in it. */
export function splitLines(kind: string, orig: string, raw: string): string[] {
  if (kind !== "bullet") return [raw];
  const lines = raw.split("\n"), keep = orig.split("\n").length;
  return [lines.slice(0, keep).join("\n"), ...lines.slice(keep).filter((t) => t.trim())];
}

export function currentText(s: S, id: string): string | null {
  const c = s.analysis?.changes.find((x) => x.target_id === id && s.selected.has(x.id));
  return c ? changeText(s, c) : null;
}

export function fullText(s: S, applied: boolean) {
  if (!s.resume) return "";
  return s.resume.paragraphs.map((p) => (applied ? currentText(s, p.id) ?? p.text : p.text)).join("\n");
}

export function acceptedEdits(s: S): Edit[] {
  return (s.analysis?.changes || []).filter((c) => s.selected.has(c.id)).map((c) => ({ target_id: c.target_id, new_text: changeText(s, c) }));
}

export const kwForTerm = (kws: Kw[], term: string) => kws.find((k) => k.term === term);

export function matchesFilter(s: AppState, c: Change) {
  const on = s.selected.has(c.id);
  if (s.filter === "on" && !on) return false;
  if (s.filter === "off" && on) return false;
  if (s.kwFilter) {
    const k = kwForTerm(s.kws, s.kwFilter), txt = changeText(s, c);
    const tagged = (c.jd_keywords || []).some((t) => t.toLowerCase() === s.kwFilter!.toLowerCase());
    if (!tagged && !(k && hasExact(k, txt))) return false;
  }
  return true;
}

export const visibleEdits = (s: AppState) => (s.analysis?.changes || []).filter((c) => matchesFilter(s, c));

/** Keyword counts before and after the accepted edits. Only the JD's exact spelling counts as present; a keyword
 * the resume spells differently ("java" for "Java") is "wrong spelling", apart from the missing ones. */
export function keywordStats(s: AppState) {
  const now = fullText(s, true);
  const before = coverage(fullText(s, false), s.kws), after = coverage(now, s.kws), spelled = misspelled(now, s.kws);
  const total = s.kws.length, had = before.size, nowN = after.size;
  const inKw = s.kws.filter((k) => after.has(k.term));
  const wrongKw = s.kws.filter((k) => spelled.has(k.term)).map((k) => ({ k, found: spelled.get(k.term)! }));
  const outKw = s.kws.filter((k) => !after.has(k.term) && !spelled.has(k.term));
  const req = s.kws.filter((k) => k.importance === "required");
  return { before, after, total, had, nowN, added: nowN - had, missing: outKw.length, inKw, wrongKw, outKw, req, reqHit: req.filter((k) => after.has(k.term)).length };
}

// ---- Add missing keywords
export const defaultGap = (): Gap => ({ choice: "add", note: "", role: "", status: "draft" });
export const gapOf = (s: Pick<AppState, "gaps">, term: string) => s.gaps[term] ?? defaultGap();

export function inResumeNow(s: AppState, term: string, text = fullText(s, true)) {
  const k = kwForTerm(s.kws, term);
  return !!k && hasExact(k, text);
}

/** In the resume, but spelled differently from the JD: the "Match JD spelling" edit fixes it, not Add missing keywords. */
export function misspelledNow(s: AppState, term: string, text = fullText(s, true)) {
  const k = kwForTerm(s.kws, term);
  return !!k && misspelled(text, [k]).size > 0;
}

export function gapStatus(s: AppState, term: string) {
  const g = gapOf(s, term);
  if (g.status === "added") return inResumeNow(s, term) ? "added" : "draft"; // its edit was skipped later: a gap again
  return g.status;
}

/** Only open gaps: once a keyword is in the resume its row goes away (the summary line says what was added). */
export function gapTerms(s: AppState) {
  const text = fullText(s, true);
  return [
    ...s.kws.map((k) => k.term).filter((t) => !inResumeNow(s, t, text) && !misspelledNow(s, t, text)),
    ...s.gapExtra.filter((t) => !kwForTerm(s.kws, t) && gapStatus(s, t) !== "added"),
  ];
}

export function gapReady(s: AppState, term: string) {
  const g = gapOf(s, term);
  return gapStatus(s, term) !== "added" && g.choice !== "skip";
}

export function gapReason(s: AppState, k: Kw): { text: string; change?: string } {
  const skipped = s.analysis?.changes.find((c) => !s.selected.has(c.id) && hasExact(k, changeText(s, c)));
  if (skipped) return { text: "A suggested edit adds this, but you skipped it.", change: skipped.id };
  const g = (s.analysis?.keyword_gaps || []).find((x) => x.term.trim().toLowerCase() === k.term.trim().toLowerCase());
  if (g) return { text: g.reason };
  return { text: "Your resume doesn't mention this yet." };
}

const CONTACT = /[\w.+-]+@[\w-]+\.\w|linkedin|github/i;
/** Roles = dated employer lines ("Acme Corp  Jan 2022 – Present"), plus the job title on the next line. */
export function roleOptions(s: Pick<AppState, "resume">) {
  if (!s.resume) return [];
  const ps = s.resume.paragraphs.filter((p) => p.text.trim() && p.kind !== "bullet"), out: string[] = [];
  const clean = (t: string) => t.replace(/\t+/g, " · ").replace(/\s{2,}/g, " ").trim();
  const dated = (t: string) => t.length < 140 && /\b(19|20)\d{2}\b|\bpresent\b/i.test(t) && !CONTACT.test(t);
  ps.forEach((p, i) => {
    if (p.section === "Header" || !dated(p.text) || /education|degree|university|college|b\.?s\.?|m\.?s\./i.test(p.section + p.text)) return;
    const next = ps[i + 1];
    const title = next && !dated(next.text) && next.kind !== "heading" && next.text.trim().length <= 60 ? ` — ${clean(next.text)}` : "";
    out.push(clean(p.text) + title);
  });
  return [...new Set(out)];
}

/** The name and contact block above the first heading, for the cover-letter letterhead. */
export function contactHeader(s: S) {
  const out: string[] = [];
  for (const p of s.resume?.paragraphs || []) {
    if (p.kind === "heading") break;
    const t = (currentText(s, p.id) ?? p.text).replace(/\t+/g, "  ").trim();
    if (t) out.push(t);
  }
  return out.slice(0, 4);
}

/** The PDF / DOCX toggle next to Download: what was picked, else the Settings choice ("both" shows as PDF). */
export const dlChoice = (s: Pick<AppState, "cfg" | "dlFormat">): DlFormat =>
  s.dlFormat ?? (s.cfg?.file_format === "docx" ? "docx" : "pdf");

/** The format Download asks for: the toggle, keeping Settings' "both" (PDF plus the .docx) when PDF is picked. */
export function requestFormat(s: Pick<AppState, "cfg" | "dlFormat">) {
  const c = dlChoice(s);
  return c === "pdf" && s.cfg?.file_format === "both" ? "both" : c;
}

/** What Download really saves: the requested format, unless PDF was asked for and no converter exists. */
export function outFormat(s: Pick<AppState, "cfg" | "dlFormat">) {
  const f = requestFormat(s);
  return f !== "docx" && !s.cfg?.pdf_converter ? "docx" : f;
}

export const resumeKey = (s: Pick<AppState, "resume">) => (s.resume ? s.resume.paragraphs.map((x) => x.text).join("\n") : "");
export const MIN_JD = 100;
export const jdOk = (s: Pick<AppState, "jdText" | "fetching">) => s.jdText.trim().length > MIN_JD && !s.fetching;
