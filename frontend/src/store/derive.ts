// Pure helpers over the app state, shared by the review page, keyword panels, cover letter and downloads.
import type { Change, Edit } from "../api/types";
import { coverage, type Kw } from "../lib/keywords";
import type { AppState, Gap } from "./app";

type S = Pick<AppState, "analysis" | "resume" | "selected" | "edits">;

export const NS = "Not specified";
export const roleLine = (s: Pick<AppState, "analysis">, sep = " · ") =>
  [s.analysis?.jd.role, s.analysis?.jd.company].filter((x) => x && x !== NS).join(sep);
export const tabLabel = (s: Pick<AppState, "analysis">) =>
  [s.analysis?.jd.company, s.analysis?.jd.role].filter((x) => x && x !== NS).join(" – ");

export const changeText = (s: Pick<AppState, "edits">, c: Change) => s.edits[c.id] ?? c.new_text;

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
    if (!tagged && !(k && k.res.some((r) => r.test(txt)))) return false;
  }
  return true;
}

export const visibleEdits = (s: AppState) => (s.analysis?.changes || []).filter((c) => matchesFilter(s, c));

/** Keyword counts before and after the accepted edits. */
export function keywordStats(s: AppState) {
  const before = coverage(fullText(s, false), s.kws), after = coverage(fullText(s, true), s.kws);
  const total = s.kws.length, had = before.size, nowN = after.size;
  const inKw = s.kws.filter((k) => after.has(k.term)), outKw = s.kws.filter((k) => !after.has(k.term));
  const req = s.kws.filter((k) => k.importance === "required");
  return { before, after, total, had, nowN, added: nowN - had, missing: total - nowN, inKw, outKw, req, reqHit: req.filter((k) => after.has(k.term)).length };
}

// ---- Add missing keywords
export const defaultGap = (): Gap => ({ choice: "add", note: "", role: "", status: "draft" });
export const gapOf = (s: Pick<AppState, "gaps">, term: string) => s.gaps[term] ?? defaultGap();

export function inResumeNow(s: AppState, term: string, text = fullText(s, true)) {
  const k = kwForTerm(s.kws, term);
  return !!k && k.res.some((r) => r.test(text));
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
    ...s.kws.map((k) => k.term).filter((t) => !inResumeNow(s, t, text)),
    ...s.gapExtra.filter((t) => !kwForTerm(s.kws, t) && gapStatus(s, t) !== "added"),
  ];
}

export function gapReady(s: AppState, term: string) {
  const g = gapOf(s, term);
  return gapStatus(s, term) !== "added" && g.choice !== "skip" && !(g.choice === "note" && !g.note.trim());
}

export function gapReason(s: AppState, k: Kw): { text: string; change?: string } {
  const skipped = s.analysis?.changes.find((c) => !s.selected.has(c.id) && k.res.some((r) => r.test(changeText(s, c))));
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

/** What Download really saves: the Settings choice, unless PDF was asked for and no converter exists. */
export function outFormat(cfg: AppState["cfg"]) {
  const f = cfg?.file_format || "pdf";
  return f !== "docx" && !cfg?.pdf_converter ? "docx" : f;
}

export const resumeKey = (s: Pick<AppState, "resume">) => (s.resume ? s.resume.paragraphs.map((x) => x.text).join("\n") : "");
export const MIN_JD = 100;
export const jdOk = (s: Pick<AppState, "jdText" | "fetching">) => s.jdText.trim().length > MIN_JD && !s.fetching;
