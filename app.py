"""Resume Optimizer — run with:  python app.py   (opens http://127.0.0.1:8765)"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import socket
import threading
import webbrowser
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ro import analyzer, claude_code, config, jd_fetch, job_search, jobs, paths, pdf_export, resume_io
from ro.jobs import check, emit

config.ensure_dirs()
config.load_env()

app = FastAPI(title="Resume Optimizer")
SESSIONS: dict[str, dict] = {}   # in-memory; one per loaded resume
DOWNLOADS: dict[str, Path] = {}
MEDIA = {".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
         ".zip": "application/zip"}


def _err(status: int, msg: str):
    raise HTTPException(status_code=status, detail=msg)


def _session(sid: str) -> dict:
    s = SESSIONS.get(sid)
    if not s:
        _err(404, "Resume session expired — load the resume again.")
    return s


def _open_resume(path: Path, uploaded: bool = False) -> dict:
    try:
        parsed = resume_io.parse_resume(path)
    except ValueError as e:
        _err(400, str(e))
    sid = secrets.token_urlsafe(8)
    name = path.name.split("_", 1)[1] if uploaded and "_" in path.name else path.name
    SESSIONS[sid] = {"path": path, "uploaded": uploaded, "file_name": name, **parsed}
    if not uploaded:
        config.save_config(last_resume_path=str(path))
    paras = parsed["paragraphs"]
    return {"session_id": sid, "file_name": name, "path": str(path),
            "source_type": parsed["source_type"], "paragraphs": paras,
            "default_output_dir": str(config.load_config().get("output_dir")
                                      or (Path.home() / "Documents" if uploaded else path.parent)),
            "keeps_formatting": parsed["source_type"] == "docx",
            "count": sum(1 for p in paras if p["text"].strip()),
            "sections": len({p["section"] for p in paras if p["kind"] == "heading"})}


def _engine_label() -> str:
    if config.active_engine() == "claude_code":
        return "Claude Code (your subscription)"
    return f"the Anthropic API ({config.get_model()})"


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


# ------------------------------------------------------------------ models
class PathIn(BaseModel):
    path: str


class PickIn(BaseModel):
    kind: str = "file"


class SettingsIn(BaseModel):
    api_key: Optional[str] = None
    model: Optional[str] = None
    engine: Optional[str] = None
    cc_model: Optional[str] = None
    output_dir: Optional[str] = None
    doc_font: Optional[str] = None       # "EB Garamond" or "keep" (the resume's own font)
    bold_keywords: Optional[bool] = None
    file_format: Optional[str] = None    # "pdf", "docx" or "both"
    name_override: Optional[str] = None  # name for file names; "" = use the name on the resume


class UrlIn(BaseModel):
    url: str


class AnalyzeIn(BaseModel):
    session_id: str
    jd_text: str


class Edit(BaseModel):
    target_id: str
    new_text: str


class CoverLetter(BaseModel):
    greeting: str = ""
    paragraphs: list[str] = []
    closing: str = ""
    signature: str = ""


class CoverIn(BaseModel):
    session_id: str
    accepted: list[Edit] = []
    hiring_manager: str = ""
    tone: str = "warm"
    why_company: str = ""


class JustifyItem(BaseModel):
    term: str
    mode: str = "add"           # "add": Claude researches it and writes it in · "note": the candidate describes it · "skip": leave it out
    justification: str = ""
    role: str = ""


class JustifyIn(BaseModel):
    session_id: str
    items: list[JustifyItem]
    accepted: list[Edit] = []


class ExportIn(BaseModel):
    session_id: str
    accepted: list[Edit]
    output_dir: Optional[str] = None
    company: str = ""
    role: str = ""
    include_resume: bool = True
    cover_letter: Optional[CoverLetter] = None
    bold_letter_keywords: bool = False


# ------------------------------------------------------------------ work (shared by sync + job endpoints)
def _fetch_work(url: str) -> dict:
    try:
        return jd_fetch.fetch_jd(url)
    except jd_fetch.FetchError as e:
        _err(422, str(e))


def _analyze_check(body: AnalyzeIn) -> dict:
    s = _session(body.session_id)
    if len(body.jd_text.strip()) < 100:
        _err(400, "The job description looks too short. Paste the full JD text.")
    return s


def _analyze_work(s: dict, jd_text: str) -> dict:
    paras = [p for p in s["paragraphs"] if p["text"].strip()]
    emit("resume", "running", f"Reading {s['file_name']}")
    emit("resume", "done", f"{_plural(len(paras), 'paragraph')} in "
         f"{_plural(sum(1 for p in paras if p['kind'] == 'heading'), 'section')}")
    check()
    engine = _engine_label()
    try:
        emit("analyze_jd", "running", f"Sending the job description to {engine}")
        jd = analyzer.analyze_jd(jd_text)
        kws = jd.get("keywords", [])
        req = sum(1 for k in kws if k.get("importance") == "required")
        emit("analyze_jd", "done",
             f"Extracted {_plural(len(kws), 'keyword')} ({req} required) and {_plural(len(jd.get('patterns', [])), 'theme')}",
             detail=[f"{k['term']} — {k.get('importance', '')}" for k in kws]
             + [f"Theme: {t}" for t in jd.get("patterns", [])])
        check()
        emit("propose", "running", f"Comparing {_plural(len(paras), 'paragraph')} against the job and drafting edits")
        raw = analyzer.propose_changes(jd, s["paragraphs"])
        emit("propose", "done", f"{_plural(len(raw.get('changes', [])), 'edit')} proposed, "
             f"{_plural(len(raw.get('suggestions', [])), 'gap')} noted")
    except analyzer.AIError as e:
        _err(502, str(e))
    check()
    emit("validate", "running", "Checking every edit against your original resume")
    result = analyzer.validate_changes(raw, s["paragraphs"])
    kept, dropped = result["changes"], result["dropped"]
    flagged = [f"{c['target_id']}: {w}" for c in kept for w in c["warnings"]]
    msg = f"{_plural(len(kept), 'edit')} kept"
    if dropped:
        msg += f", {len(dropped)} dropped"
    if flagged:
        msg += f", {len({f.split(':')[0] for f in flagged})} flagged for you to verify"
    emit("validate", "done", msg, detail=[f"Dropped {d}" for d in dropped] + [f"Flagged {f}" for f in flagged] or None)
    s["jd"] = jd
    return {"jd": jd, **result}


def _cover_check(body: CoverIn) -> dict:
    s = _session(body.session_id)
    if not s.get("jd"):
        _err(400, "Analyze the job first — the cover letter is based on that analysis.")
    return s


def _cover_work(s: dict, body: CoverIn) -> dict:
    edits = {e.target_id: e.new_text for e in body.accepted}
    emit("prepare", "running", "Applying your selected edits to the resume text")
    text = resume_io.applied_text(s["paragraphs"], edits)
    emit("prepare", "done", f"Using the resume with {_plural(len(edits), 'selected edit')}")
    check()
    tone = body.tone if body.tone in analyzer.TONES else "warm"
    try:
        emit("cover", "running", f"Writing a {tone} cover letter via {_engine_label()}")
        notes = [f'{j["term"]}: {j["justification"]}' for j in s.get("justifications", [])]
        raw = analyzer.write_cover_letter(s["jd"], text, body.hiring_manager, tone, body.why_company, notes)
    except analyzer.AIError as e:
        _err(502, str(e))
    check()
    emit("check", "running", "Checking the letter's claims against your resume")
    letter = analyzer.validate_cover_letter(raw, text)
    if not letter["signature"]:
        header = resume_io.contact_header(s["paragraphs"], edits)
        letter["signature"] = header[0] if header else ""
    emit("cover", "done", f"Drafted {letter['word_count']} words in {_plural(len(letter['paragraphs']), 'paragraph')}")
    w = letter["warnings"]
    emit("check", "done", f"{_plural(len(w), 'thing')} to double-check" if w else "No issues found",
         detail=w or None)
    s["cover"] = letter
    return letter


def _justify_check(body: JustifyIn) -> dict:
    s = _session(body.session_id)
    if not s.get("jd"):
        _err(400, "Analyze the job first.")
    items = [i for i in body.items if i.term.strip()]
    bad = [i.term for i in items if i.mode not in ("add", "note", "skip")]
    if bad:
        _err(400, f"Unknown option for {', '.join(bad)}.")
    if not any(i.mode != "skip" for i in items):
        _err(400, "Choose “Add it” or “Describe it” for at least one keyword.")
    empty = [i.term for i in items if i.mode == "note" and not i.justification.strip()]
    if empty:
        _err(400, "Write a quick note about " + ", ".join(empty) + ", or switch it to “Add it”.")
    return s


SKILLS_CAP = 3  # new Skills-line items per run: more reads as keyword stuffing
_SEPS = (", ", " | ", " · ", " • ")
# where a new tool sits in a skills list: right after the first of these already there
RELATED = {"postgresql": ("sql", "mysql"), "mysql": ("sql", "postgresql"), "sqlite": ("sql",), "mongodb": ("sql", "redis"),
           "redis": ("postgresql", "sql"), "kubernetes": ("docker",), "helm": ("kubernetes", "docker"),
           "docker": ("kubernetes", "aws"), "terraform": ("aws", "gcp", "azure", "docker"), "ansible": ("terraform", "docker"),
           "grafana": ("prometheus",), "prometheus": ("grafana", "docker"), "datadog": ("grafana", "prometheus"),
           "fastapi": ("flask", "django"), "django": ("flask", "fastapi"), "flask": ("django", "fastapi", "python"),
           "typescript": ("javascript",), "javascript": ("typescript",), "react": ("typescript", "javascript"),
           "node.js": ("javascript", "typescript"), "kafka": ("rabbitmq", "redis"), "rabbitmq": ("kafka",),
           "gcp": ("aws", "azure"), "azure": ("aws", "gcp"), "github actions": ("git", "jenkins"), "jenkins": ("git",),
           "ci/cd": ("git", "jenkins"), "ci/cd pipelines": ("git", "jenkins"), "pytest": ("python",), "go": ("python", "java"), "java": ("python", "go")}


def _seps(t: str) -> int:
    return max(t.count(x.strip()) for x in _SEPS)


def _is_skills_list(p: dict, text: str) -> bool:
    return "skill" in p["section"].lower() and p["kind"] != "heading" and _seps(text) >= 2


def _split_list(text: str) -> tuple[str, list[str], str]:
    """'Python, Flask, SQL.' -> (', ', ['Python', 'Flask', 'SQL'], '.')"""
    sep = max(_SEPS, key=lambda x: text.count(x.strip()))
    end = re.search(r"[.;]$", text.rstrip())
    body = text.rstrip()[:-1] if end else text.rstrip()
    return sep, [x.strip() for x in body.split(sep.strip())], end.group(0) if end else ""


_CONCEPT = re.compile(r"\b(architecture|design|ownership|engineering|development|management|practices|principles|"
                      r"culture|collaboration|leadership|mindset)\b|(ility|ing)$", re.I)


def _skill_ok(term: str, soft: set[str]) -> bool:
    """Only concrete tools fit a skills list: no soft skills, no phrase longer than two words, and no practices or
    qualities ("microservices architecture", "end-to-end ownership", "scalability", "mentoring")."""
    return term.lower() not in soft and len(term.split()) <= 2 and not _CONCEPT.search(term.strip())


def _insert_related(items: list[str], term: str) -> list[str]:
    low = [x.lower() for x in items]
    for rel in RELATED.get(term.lower(), ()):
        for n, x in enumerate(low):
            if x == rel or x.endswith(": " + rel):  # "Languages: Python"
                return items[:n + 1] + [term] + items[n + 1:]
    words = {w for w in re.findall(r"[a-z]{3,}", term.lower())}
    for n, x in enumerate(low):  # same family by name: "SQL" -> "PostgreSQL", "AWS Lambda" -> "AWS"
        if any(w in x for w in words) or any(len(y) >= 3 and y in term.lower() for y in re.findall(r"[a-z.]+", x)):
            return items[:n + 1] + [term] + items[n + 1:]
    return items + [term]


def _trim_skills_change(c: dict, before: str, terms: list[str], soft: set[str], budget: list[int]) -> None:
    """Hold Claude's Skills-line edit to the rules: drop soft skills and long phrases, keep within the cap."""
    sep, items, end = _split_list(c["new_text"])
    old = {x.lower() for x in _split_list(before)[1]}
    out = []
    for x in items:
        if x.lower() in old or not x:
            out.append(x); continue
        hit = next((t for t in terms if analyzer.mentions(x, t)), None)
        if hit and _skill_ok(hit, soft) and budget[0] > 0:
            budget[0] -= 1; out.append(x)
        elif not hit and budget[0] > 0:  # not one of ours (Claude regrouped something): leave it, but count it
            budget[0] -= 1; out.append(x)
    c["new_text"] = sep.join(out) + end


def _skills_fallback(paragraphs: list[dict], edits: dict[str, str], kept: list[dict], terms: list[str],
                     cid: str) -> tuple[list[dict], list[str]]:
    """Insert terms into the resume's skills list (the Skills-section line with the most items), each next to
    the item it relates to. Builds on an edit already made to that line. Returns (kept, terms placed)."""
    lines = [p for p in paragraphs if p["text"].strip() and _is_skills_list(p, edits.get(p["id"], p["text"]))]
    if not lines or not terms:
        return kept, []
    p = max(lines, key=lambda p: _seps(edits.get(p["id"], p["text"])))
    prior = next((c for c in kept if c["target_id"] == p["id"]), None)
    sep, items, end = _split_list(prior["new_text"] if prior else edits.get(p["id"], p["text"]))
    for t in terms:
        items = _insert_related(items, t)
    new_text = sep.join(items) + end
    note = f"Added {', '.join(terms)} to your skills list."
    if prior:
        prior.update(new_text=new_text, jd_keywords=prior["jd_keywords"] + terms,
                     from_input=", ".join(prior["jd_keywords"] + terms))
        prior["reason"] = f"{prior['reason']} {note}".strip()
        return kept, terms
    return kept + [{"id": cid, "target_id": p["id"], "section": p["section"], "kind": p["kind"],
                    "original_text": p["text"], "new_text": new_text, "type": "keyword", "reason": note,
                    "jd_keywords": terms, "warnings": [], "from_input": ", ".join(terms), "source": "add"}], terms


def _justify_work(s: dict, body: JustifyIn) -> dict:
    items = [{"term": i.term.strip(), "mode": i.mode, "justification": i.justification.strip() if i.mode == "note" else "",
              "role": i.role.strip()} for i in body.items if i.term.strip() and i.mode != "skip"]
    asked = {i["term"].lower(): i["term"] for i in items}
    researched = {i["term"] for i in items if i["mode"] == "add"}
    edits = {e.target_id: e.new_text for e in body.accepted}
    noted = [i for i in items if i["mode"] == "note"]
    emit("note", "running", f"Reading your input for {_plural(len(items), 'keyword')}")
    s.setdefault("justifications", []).extend(noted)  # only the candidate's own words become evidence
    emit("note", "done", ", ".join(i["term"] + (" (your note)" if i["mode"] == "note" else "") for i in items))
    check()
    try:
        emit("decide", "running", f"Asking {_engine_label()} to research and place {_plural(len(items), 'keyword')}")
        raw = analyzer.decide_keywords(s["jd"], s["paragraphs"], edits, items)
    except analyzer.AIError as e:
        _err(502, str(e))
    check()

    decisions = {}
    for d in raw.get("decisions", []) or []:
        term = asked.get((d.get("term") or "").strip().lower())
        if term and term not in decisions:  # ignore terms we didn't ask about
            decisions[term] = {"term": term, "evidence": "weak" if d.get("evidence") == "weak" else "strong",
                               "explanation": (d.get("explanation") or "").strip(),
                               "based_on": (d.get("based_on") or "").strip()}
    for term in asked.values():
        decisions.setdefault(term, {"term": term, "evidence": "weak", "explanation": "", "based_on": ""})
    emit("decide", "done", f"Placed {_plural(len(decisions), 'keyword')}",
         detail=[f"{d['term']}: {d['explanation']}" for d in decisions.values() if d["explanation"]] or None)

    emit("check", "running", "Checking the new wording against your resume and notes")
    notes = "\n".join(i["justification"] for i in noted)
    terms = list(asked.values())
    result = analyzer.validate_changes(raw, s["paragraphs"], known_text=notes, id_prefix=f"k{secrets.token_hex(2)}_",
                                       limit=1 + len(terms), current=edits)
    per_kw: dict[str, int] = {}
    kept, dropped = [], list(result["dropped"])
    # apply the per-keyword limit in Claude's order (ids end in the original index), show in resume order
    soft = {k["term"].lower() for k in s["jd"].get("keywords", []) if k.get("category") == "soft_skill"}
    by_id = {p["id"]: p for p in s["paragraphs"]}
    budget = [SKILLS_CAP]  # new Skills-line items left, shared by Claude's edits and the fallback
    for c in sorted(result["changes"], key=lambda c: int(c["id"].rsplit("_", 1)[1])):
        before = edits.get(c["target_id"], c["original_text"])
        if _is_skills_list(by_id[c["target_id"]], before):
            _trim_skills_change(c, before, terms, soft, budget)
        adds = [t for t in terms if analyzer.mentions(c["new_text"], t) and not analyzer.mentions(before, t)]
        if not adds:
            dropped.append(f"{c['target_id']}: doesn't add any keyword you marked")
            continue
        if all(per_kw.get(t, 0) >= 2 for t in adds):
            dropped.append(f"{c['target_id']}: over the 2-paragraph limit for {', '.join(adds)}")
            continue
        lost = [k["term"] for k in s["jd"].get("keywords", [])
                if analyzer.mentions(before, k["term"]) and not analyzer.mentions(c["new_text"], k["term"])]
        if lost:
            c["warnings"].append(f"Drops {', '.join(lost)}, which this line had — check that's intended.")
        for t in adds:
            per_kw[t] = per_kw.get(t, 0) + 1
        c["jd_keywords"], c["from_input"] = adds, ", ".join(adds)
        c["source"] = "add" if any(t in researched for t in adds) else "note"
        kept.append(c)
    # a tool no kept edit carries goes on the Skills line, most important first, within the cap
    rank = {k["term"].lower(): {"required": 0, "preferred": 1}.get(k.get("importance"), 2) for k in s["jd"].get("keywords", [])}
    tools = sorted((t for t in terms if not per_kw.get(t) and _skill_ok(t, soft)), key=lambda t: rank.get(t.lower(), 2))
    missing = tools[:max(budget[0], 0)]
    capped = set(tools[len(missing):])  # tools left out only because the Skills line is full
    if missing:
        kept, placed = _skills_fallback(s["paragraphs"], edits, kept, missing, f"k{secrets.token_hex(2)}_s")
        for t in placed:
            per_kw[t] = 1
            decisions[t].update(evidence="weak", explanation=f"Added “{t}” to your Skills line.")
    for c in kept:
        weak = [t for t in c["jd_keywords"] if decisions[t]["evidence"] == "weak" and t in researched]
        if weak:
            c["warnings"].append(f"Your resume only shows related work for {', '.join(weak)}. Keep it if it's true.")
    pos = {p["id"]: n for n, p in enumerate(s["paragraphs"])}
    kept.sort(key=lambda c: pos.get(c["target_id"], 0))
    for t, d in decisions.items():
        d["added"] = bool(per_kw.get(t))
        if d["added"]:
            continue
        d["explanation"] = (f"Your Skills line already got {SKILLS_CAP} new items this round, so “{t}” was left out to "
                            "avoid keyword stuffing. Use Describe it to say where you used it, or Skip it." if t in capped else
                            f"No line in your resume fits “{t}” naturally, so it was left out rather than stuffed in. "
                            "Use Describe it to say where you used it, or Skip it.")
    added = sorted(per_kw)
    flagged = [w for c in kept for w in c["warnings"]]
    emit("check", "done", f"{_plural(len(kept), 'edit')} ready for {_plural(len(added), 'keyword')}"
         + (f", {len(flagged)} to verify" if flagged else ""),
         detail=[f"Dropped {d}" for d in dropped] + flagged or None)
    return {"decisions": [decisions[t] for t in asked.values()], "changes": kept, "dropped": dropped}


def _out_dir(s: dict, output_dir: Optional[str]) -> Path:
    if output_dir and output_dir.strip():
        try:
            out_dir = paths.resolve_user_path(output_dir, must_exist=False)
            out_dir.mkdir(parents=True, exist_ok=True)
        except (paths.PathError, OSError) as e:
            _err(400, f"Can't use that output folder: {e}")
        config.save_config(output_dir=str(out_dir))
    else:
        out_dir = Path.home() / "Documents" if s["uploaded"] else s["path"].parent
        out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir


def _export_check(body: ExportIn) -> tuple[dict, Path]:
    s = _session(body.session_id)
    if not body.include_resume and not body.cover_letter:
        _err(400, "Nothing to export.")
    return s, _out_dir(s, body.output_dir)


def _download(p: Path) -> dict:
    token = secrets.token_urlsafe(10)
    DOWNLOADS[token] = p
    return {"path": str(p), "file_name": p.name, "download_url": f"/api/download/{token}"}


def _jd_terms(s: dict) -> list[str]:
    """Every job-posting keyword and its variants, for bolding."""
    kws = (s.get("jd") or {}).get("keywords", [])
    return [t for k in kws for t in [k.get("term", ""), *(k.get("variants") or [])] if t and t.strip()]


def _file_names(s: dict, edits: dict[str, str]) -> dict:
    """Stems like Yashwanth_Varre_Acme_Software_Engineer_Resume, plus document title/author for each file."""
    override = config.get_name_override()
    header = resume_io.contact_header(s["paragraphs"], edits)
    name = resume_io.name_words(override or (header[0] if header else ""))
    jd = s.get("jd") or {}
    role = resume_io.role_words(jd.get("role", ""))
    company = resume_io.company_words(jd.get("company", ""))
    stems = {k: resume_io.file_stem(name, role, kind, company) for k, kind in
             (("resume", "Resume"), ("cover", "Cover_Letter"), ("zip", "Application"))}
    titles = {k: v.replace("_", " ") for k, v in stems.items()}
    return {"stems": stems, "titles": titles, "author": " ".join(name), "name_found": bool(name),
            "from_settings": bool(override)}


def _formats() -> tuple[bool, bool, str]:
    """(pdf, docx, notice) for this export, from the Settings choice and whether a PDF converter exists."""
    fmt = config.get_file_format()
    pdf, docx = fmt in ("pdf", "both"), fmt in ("docx", "both")
    if pdf and not pdf_export.converter():
        return False, True, pdf_export.missing_message() + " Saved as .docx instead."
    return pdf, docx, ""


def _save_as(kind: str, docx_path: Path, pdf_path: Path, want_pdf: bool, want_docx: bool,
             build, label: str) -> tuple[list[Path], str, int]:
    """Build the .docx, convert it to PDF when asked, keep the .docx only when asked.
    Returns (files, notice, pdf_pages). A failed conversion falls back to the .docx."""
    work = docx_path if want_docx else config.CONFIG_DIR / "tmp" / docx_path.name
    work.parent.mkdir(parents=True, exist_ok=True)
    emit(f"{kind}_docx", "running", label)
    build(work)
    emit(f"{kind}_docx", "done", f"Laid out {work.stem}" if not want_docx else f"Saved {work.name}",
         detail=[str(work)] if want_docx else None)
    check()
    if not want_pdf:
        return [work], "", 0
    emit(f"{kind}_pdf", "running", f"Converting to PDF ({pdf_export.converter()})")
    try:
        pdf_export.docx_to_pdf(work, pdf_path)
    except pdf_export.PdfError as e:
        if work != docx_path:
            shutil.move(str(work), docx_path)
        emit(f"{kind}_pdf", "error", str(e))
        return [docx_path], f"{e} Saved {docx_path.name} instead.", 0
    finally:
        if work != docx_path:
            work.unlink(missing_ok=True)
    pages = pdf_export.page_count(pdf_path)
    emit(f"{kind}_pdf", "done", f"Saved {pdf_path.name}" + (f" · {pages} pages" if pages > 1 else ""),
         detail=[str(pdf_path)])
    return ([pdf_path, docx_path] if want_docx else [pdf_path]), "", pages


def _export_work(s: dict, out_dir: Path, body: ExportIn) -> dict:
    edits = {e.target_id: e.new_text for e in body.accepted}
    font, bold, terms = config.get_doc_font(), config.get_bold_keywords(), _jd_terms(s)
    want_pdf, want_docx, notice = _formats()
    names = _file_names(s, edits)
    out: dict = {"applied": len(edits), "format": "pdf" if want_pdf else "docx", "notices": [notice] if notice else []}
    if not names["name_found"]:
        out["notices"].append("Couldn't find your name on the resume, so the files are named generically. "
                              "Add it in Settings → \"Your name for file names\".")
    made: list[Path] = []
    try:
        if body.include_resume:
            docx_path, pdf_path = resume_io.output_pair(out_dir, names["stems"]["resume"])
            how = (f"Applying {_plural(len(edits), 'change')} to a copy of {s['file_name']}"
                   if s["source_type"] == "docx" else "Building a clean ATS-friendly layout")
            files, note, pages = _save_as("resume", docx_path, pdf_path, want_pdf, want_docx, lambda dest: resume_io.export_docx(
                s["path"], s["source_type"], s["paragraphs"], edits, dest, keywords=terms, font=font, bold=bold,
                title=names["titles"]["resume"], author=names["author"]), how)
            out.update(_download(files[0]))
            out["files"], out["pages"] = [_download(f) for f in files], pages
            out["notices"] += [note] if note else []
            made += files
            check()
        if body.cover_letter:
            docx_path, pdf_path = resume_io.output_pair(out_dir, names["stems"]["cover"])
            letter, header = body.cover_letter.model_dump(), resume_io.contact_header(s["paragraphs"], edits)
            files, note, pages = _save_as("cover", docx_path, pdf_path, want_pdf, want_docx, lambda dest: resume_io.export_cover_letter(
                letter, header, dest, keywords=terms, font=font, bold=body.bold_letter_keywords,
                title=names["titles"]["cover"], author=names["author"]), "Writing the cover letter")
            out["cover"] = {**_download(files[0]), "files": [_download(f) for f in files], "pages": pages}
            out["notices"] += [note] if note else []
            made += files
    except PermissionError:
        _err(400, f"Can't write to {out_dir}. Choose another output folder.")
    if body.include_resume and body.cover_letter:
        emit("zip", "running", "Bundling the files")
        zdir = config.CONFIG_DIR / "downloads"
        zdir.mkdir(parents=True, exist_ok=True)
        zpath = resume_io.output_path(zdir, names["stems"]["zip"], ext=".zip")
        with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
            for f in made:
                z.write(f, f.name)
        emit("zip", "done", f"Created {zpath.name}")
        out["zip"] = _download(zpath)
    return out


# ------------------------------------------------------------------ routes
@app.get("/api/config")
def get_config():
    cfg = config.load_config()
    cc_path = claude_code.find_claude()
    return {"last_resume_path": cfg.get("last_resume_path", ""), "output_dir": cfg.get("output_dir", ""),
            "has_api_key": config.has_api_key(), "model": config.get_model(),
            "engine": config.get_engine_pref(), "active_engine": config.active_engine(),
            "claude_code_path": cc_path or "", "cc_model": config.get_cc_model(),
            "doc_font": config.get_doc_font(), "bold_keywords": config.get_bold_keywords(),
            "file_format": config.get_file_format(), "name_override": config.get_name_override(), "pdf_converter": pdf_export.converter(),
            "pdf_missing": pdf_export.missing_message(),
            "playwright": jd_fetch.playwright_available(), "home": str(Path.home()), "os": os.name}


class NamesIn(BaseModel):
    session_id: str
    accepted: list[Edit] = []


@app.post("/api/file_names")
def file_names(body: NamesIn):
    """What Download will call the files (before any _2 suffix), for the UI to show."""
    s = _session(body.session_id)
    names = _file_names(s, {e.target_id: e.new_text for e in body.accepted})
    return {**names["stems"], "name_found": names["name_found"], "from_settings": names["from_settings"]}


@app.post("/api/settings")
def save_settings(body: SettingsIn):
    if body.api_key and body.api_key.strip():
        config.save_api_key(body.api_key)
    if body.model and body.model.strip():
        config.save_config(model=body.model.strip())
    if body.engine in config.ENGINES:
        config.save_config(engine=body.engine)
    if body.cc_model is not None:
        config.save_config(cc_model=body.cc_model.strip())
    if body.doc_font in config.DOC_FONTS:
        config.save_config(doc_font=body.doc_font)
    if body.name_override is not None:
        config.save_config(name_override=body.name_override.strip()[:80])
    if body.file_format in config.FILE_FORMATS:
        config.save_config(file_format=body.file_format)
    if body.bold_keywords is not None:
        config.save_config(bold_keywords=body.bold_keywords)
    if body.output_dir is not None:
        out = body.output_dir.strip()
        if out:
            try:
                resolved = paths.resolve_user_path(out, must_exist=False)
                resolved.mkdir(parents=True, exist_ok=True)
            except (paths.PathError, OSError) as e:
                _err(400, f"Can't use that folder: {e}")
            config.save_config(output_dir=str(resolved))
        else:
            cfg = config.load_config(); cfg.pop("output_dir", None)
            config.CONFIG_FILE.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    return get_config()


@app.post("/api/pick")
def pick(body: PickIn):
    try:
        return {"path": paths.pick_native(body.kind)}
    except paths.PathError as e:
        _err(400, str(e))


@app.post("/api/resume/load")
def load_resume(body: PathIn):
    try:
        p = paths.resolve_user_path(body.path)
    except paths.PathError as e:
        _err(400, str(e))
    return _open_resume(p)


@app.post("/api/resume/upload")
async def upload_resume(file: UploadFile = File(...)):
    name = Path(file.filename or "resume").name
    if Path(name).suffix.lower() not in paths.SUPPORTED:
        _err(400, "Upload a .docx, .pdf or .txt file.")
    dest = config.UPLOAD_DIR / f"{secrets.token_hex(3)}_{name}"
    dest.write_bytes(await file.read())
    return _open_resume(dest, uploaded=True)


class SessionIn(BaseModel):
    session_id: str


@app.post("/api/resume/clone")
def clone_resume(body: SessionIn):
    """A fresh session on the same resume file, for a job opened in its own tab: each tab keeps its own JD,
    edits and cover letter, and nobody has to load the resume again."""
    s = _session(body.session_id)
    if not Path(s["path"]).exists():
        _err(404, "The resume file is no longer there — load it again.")
    d = _open_resume(Path(s["path"]), uploaded=s["uploaded"])
    SESSIONS[d["session_id"]]["file_name"] = d["file_name"] = s["file_name"]
    return d


def _find_jobs_work(s: dict) -> dict:
    text = "\n".join(p["text"] for p in s["paragraphs"] if p["text"].strip())
    emit("profile", "running", f"Reading {s['file_name']}")
    emit("profile", "done", f"{_plural(len(text.split()), 'word')} to match jobs against")
    check()
    try:
        emit("search", "running", f"Searching job boards with {_engine_label()} (this can take a few minutes)")
        found = job_search.find_jobs(text)
    except analyzer.AIError as e:
        _err(502, str(e))
    emit("search", "done", found["profile"] or "Search finished")
    n = len(found["jobs"])
    emit("check", "done", f"{_plural(n, 'posting')} from the last 2 hours"
         + (f", {len(found['dropped'])} left out" if found["dropped"] else ""),
         detail=[f"{j['title']} at {j['company']} — {j['age_minutes']} min ago" for j in found["jobs"]]
         + [f"Left out {d}" for d in found["dropped"]] or None)
    return found


# synchronous endpoints (no progress events) — kept for scripts and tests
@app.post("/api/jd/fetch")
def fetch_jd(body: UrlIn):
    return _fetch_work(body.url)


@app.post("/api/analyze")
def analyze(body: AnalyzeIn):
    return _analyze_work(_analyze_check(body), body.jd_text)


@app.post("/api/cover_letter")
def cover_letter(body: CoverIn):
    return _cover_work(_cover_check(body), body)


@app.post("/api/justify_keywords")
def justify_keywords(body: JustifyIn):
    return _justify_work(_justify_check(body), body)


@app.post("/api/export")
def export(body: ExportIn):
    s, out_dir = _export_check(body)
    return _export_work(s, out_dir, body)


# background jobs with live progress — what the UI uses
def _job_out(job: jobs.Job) -> dict:
    return {"job_id": job.id, "kind": job.kind, "title": job.title, "plan": job.plan}


@app.post("/api/jobs/jd_fetch")
def job_fetch(body: UrlIn):
    plan = [("fetch", "Fetch the posting"), ("extract", "Extract the job description")]
    return _job_out(jobs.start("jd_fetch", "Fetch job posting", plan, lambda: _fetch_work(body.url)))


@app.post("/api/jobs/analyze")
def job_analyze(body: AnalyzeIn):
    s = _analyze_check(body)
    plan = [("resume", "Read your resume"), ("analyze_jd", "Analyze the job description"),
            ("propose", "Draft resume edits"), ("validate", "Honesty checks")]
    return _job_out(jobs.start("analyze", "Analyze & optimize", plan, lambda: _analyze_work(s, body.jd_text)))


@app.post("/api/jobs/cover_letter")
def job_cover(body: CoverIn):
    s = _cover_check(body)
    plan = [("prepare", "Apply your selected edits"), ("cover", "Write the cover letter"),
            ("check", "Check claims against your resume")]
    return _job_out(jobs.start("cover_letter", "Write cover letter", plan, lambda: _cover_work(s, body)))


@app.post("/api/jobs/justify_keywords")
def job_justify(body: JustifyIn):
    s = _justify_check(body)
    n = len([i for i in body.items if i.term.strip()])
    plan = [("note", f"Read your input ({n})"), ("decide", "Research and place keywords"), ("check", "Honesty checks")]
    return _job_out(jobs.start("justify_keywords", f"Fill {_plural(n, 'keyword gap')}", plan,
                               lambda: _justify_work(s, body)))


@app.post("/api/jobs/find_jobs")
def job_find_jobs(body: SessionIn):
    s = _session(body.session_id)
    plan = [("profile", "Read your resume"), ("search", "Search for postings from the last 2 hours"),
            ("check", "Check posting times and links")]
    return _job_out(jobs.start("find_jobs", "Find fresh jobs", plan, lambda: _find_jobs_work(s)))


@app.post("/api/jobs/export")
def job_export(body: ExportIn):
    s, out_dir = _export_check(body)
    pdf, docx, _ = _formats()
    plan = []
    for kind, on, name in (("resume", body.include_resume, "resume"), ("cover", bool(body.cover_letter), "cover letter")):
        if on:
            plan.append((f"{kind}_docx", f"Lay out the {name}" if not docx else f"Build {name} .docx"))
            if pdf:
                plan.append((f"{kind}_pdf", f"Convert the {name} to PDF"))
    if body.include_resume and body.cover_letter:
        plan.append(("zip", "Bundle as .zip"))
    title = "Export " + " + ".join(x for x, on in (("resume", body.include_resume),
                                                    ("cover letter", bool(body.cover_letter))) if on)
    return _job_out(jobs.start("export", title, plan, lambda: _export_work(s, out_dir, body)))


def _job(job_id: str) -> jobs.Job:
    job = jobs.get(job_id)
    if not job:
        _err(404, "That job is no longer available.")
    return job


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str, since: int = 0):
    """Polling fallback for browsers/proxies where Server-Sent Events don't work."""
    return _job(job_id).snapshot(since)


@app.get("/api/jobs/{job_id}/events")
def job_events(job_id: str, since: int = 0, last_event_id: Optional[str] = Header(None)):
    job = _job(job_id)
    if last_event_id and last_event_id.isdigit():  # EventSource reconnect: resume after the last one seen
        since = max(since, int(last_event_id) + 1)

    def stream():
        i = since
        while True:
            evs, done = job.wait(i, timeout=15)
            for ev in evs:
                yield f"id: {ev['seq']}\ndata: {json.dumps(ev)}\n\n"
            i += len(evs)
            if done and i >= len(job.events):
                yield f"event: end\ndata: {json.dumps(job.end_payload())}\n\n"
                return
            if not evs:
                yield ": keep-alive\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/jobs/{job_id}/cancel")
def job_cancel(job_id: str):
    job = _job(job_id)
    job.cancel_requested.set()
    return {"ok": True, "status": job.status}


@app.get("/api/download/{token}")
def download(token: str):
    p = DOWNLOADS.get(token)
    if not p or not p.exists():
        _err(404, "File not found.")
    return FileResponse(p, filename=p.name, media_type=MEDIA.get(p.suffix.lower(), "application/octet-stream"))


class _FreshStatic(StaticFiles):
    """Browsers revalidate the UI files on every load, so an updated app never runs stale JS."""
    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "no-cache"
        return resp


app.mount("/", _FreshStatic(directory=Path(__file__).parent / "static", html=True), name="static")


def _free_port(start: int) -> int:
    for port in range(start, start + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return start


if __name__ == "__main__":
    import uvicorn
    ap = argparse.ArgumentParser(description="Resume Optimizer")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    port = _free_port(args.port)
    url = f"http://127.0.0.1:{port}"
    print(f"\n  Resume Optimizer running at {url}\n  Press Ctrl+C to stop.\n")
    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
