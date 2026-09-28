"""Read resumes into editable paragraphs and write the optimized .docx.

DOCX: every paragraph (body, tables, text boxes) gets a stable id "p<n>". On export we
edit a *copy* of the original and only touch the characters that actually changed,
so fonts, bold/italic runs, bullets, tabs and layout survive.

PDF / TXT: layout can't be recovered, so we rebuild a clean ATS-friendly .docx.
"""
from __future__ import annotations

import difflib
import re
import shutil
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, Inches, RGBColor
from docx.oxml import OxmlElement

W_P, W_R, W_T = qn("w:p"), qn("w:r"), qn("w:t")
W_TAB, W_BR, W_CR = qn("w:tab"), qn("w:br"), qn("w:cr")
MC_FALLBACK = "{http://schemas.openxmlformats.org/markup-compatibility/2006}Fallback"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"
BULLET_RE = re.compile(r"^\s*[•●▪■◦‣∙·\-–*\uf000-\uf0ff➢➤►▸✓✔]\s*(?=\S)")
PUA_BULLET = re.compile(r"^\s*[\uf000-\uf0ff]\s*")


# --------------------------------------------------------------------------- DOCX internals
def _docx_paragraphs(doc) -> list:
    """All w:p elements in reading order, skipping duplicate VML fallbacks of text boxes."""
    out = []
    for p in doc.element.body.iter(W_P):
        if any(a.tag == MC_FALLBACK for a in p.iterancestors()):
            continue
        out.append(p)
    return out


def _segments(p) -> list[list]:
    """[(element, kind, text)] for runs that belong directly to paragraph p (incl. hyperlinks)."""
    segs = []
    for r in p.iter(W_R):
        if next(r.iterancestors(W_P), None) is not p:
            continue  # run belongs to a nested paragraph (text box)
        for child in r:
            if child.tag == W_T:
                segs.append([child, "t", child.text or ""])
            elif child.tag == W_TAB:
                segs.append([child, "fixed", "\t"])
            elif child.tag in (W_BR, W_CR):
                segs.append([child, "fixed", "\n"])
    return segs


def _p_text(p) -> str:
    return "".join(s[2] for s in _segments(p))


def _tokens(s: str) -> list[str]:
    return re.findall(r"\w+|\W", s)


def _apply_text(p, new: str) -> None:
    """Replace paragraph text with `new`, rewriting only the words that changed.

    A word-level diff is applied hunk by hunk (right to left), so unchanged words keep
    their exact run formatting (bold company names, italic tools, hyperlinks, tabs).
    """
    old = _p_text(p)
    if old == new:
        return
    segs = _segments(p)
    if not segs:  # empty paragraph: add a run to write into
        r = OxmlElement("w:r")
        t = OxmlElement("w:t")
        t.set(XML_SPACE, "preserve")
        r.append(t)
        p.append(r)
    a, b = _tokens(old), _tokens(new)
    a_pos = [0]
    for tok in a:
        a_pos.append(a_pos[-1] + len(tok))
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    hunks = [(a_pos[i1], a_pos[i2], "".join(b[j1:j2]))
             for op, i1, i2, j1, j2 in sm.get_opcodes() if op != "equal"]
    for start, end, text in reversed(hunks):
        _replace_range(p, start, end, text)


def _replace_range(p, start: int, end: int, middle: str) -> None:
    """Replace characters [start, end) of the paragraph text with `middle`."""
    # give every tab/break an editable text slot right before it, so text can be
    # inserted at positions that sit next to a tab (e.g. start of a tab-led line)
    for s in _segments(p):
        if s[1] == "fixed":
            prev = s[0].getprevious()
            if prev is None or prev.tag != W_T:
                slot = OxmlElement("w:t")
                slot.set(XML_SPACE, "preserve")
                s[0].addprevious(slot)
            nxt = s[0].getnext()
            if nxt is None or nxt.tag != W_T:
                slot = OxmlElement("w:t")
                slot.set(XML_SPACE, "preserve")
                s[0].addnext(slot)
    segs = _segments(p)
    text_segs = [s for s in segs if s[1] == "t"]
    middle = middle.replace("\n", " ")
    pos, spans = 0, []
    for s in segs:
        spans.append((pos, pos + len(s[2])))
        pos += len(s[2])

    # anchor: the run whose formatting the new text inherits
    anchor = None
    for s, (a, b) in zip(segs, spans):
        if s[1] == "t" and a < end and b > start and a <= start:
            anchor = s
            break
    if anchor is None:
        for s, (a, b) in zip(segs, spans):
            if s[1] == "t" and a < start <= b:   # insertion right after this run's text
                anchor = s
                break
    if anchor is None:
        for s, (a, b) in zip(segs, spans):
            if s[1] == "t" and a < end and b > start:
                anchor = s
                break
    if anchor is None:
        for s, (a, b) in zip(segs, spans):
            if s[1] == "t" and a <= start <= b:
                anchor = s
                break
    if anchor is None:
        anchor = text_segs[0]

    for s, (a, b) in zip(segs, spans):
        overlaps = a < end and b > start
        if s[1] == "fixed":
            if overlaps:
                s[0].getparent().remove(s[0])
            continue
        if not overlaps and s is not anchor:
            continue
        t = s[2]
        if s is anchor and not overlaps:
            k = min(max(0, start - a), len(t))
            left, right = t[:k], t[k:]
        else:
            left = t[:max(0, start - a)]
            right = t[max(0, end - a):] if end - a < len(t) else ""
        s[0].set(XML_SPACE, "preserve")
        if s is not anchor:
            s[0].text = left + right
            continue
        # tabs in the new text become real <w:tab/> elements
        parts = middle.split("\t")
        s[0].text = left + parts[0]
        cur = s[0]
        for part in parts[1:]:
            tab = OxmlElement("w:tab")
            cur.addnext(tab)
            nt = OxmlElement("w:t")
            nt.set(XML_SPACE, "preserve")
            nt.text = part
            tab.addnext(nt)
            cur = nt
        cur.text = (cur.text or "") + right


def _docx_kind(p, text: str) -> str:
    ppr = p.find(qn("w:pPr"))
    style = ""
    if ppr is not None:
        ps = ppr.find(qn("w:pStyle"))
        style = (ps.get(qn("w:val")) if ps is not None else "") or ""
        if ppr.find(qn("w:numPr")) is not None:
            return "bullet"
    sl = style.lower()
    if "list" in sl or BULLET_RE.match(text):
        return "bullet"
    if sl.startswith("heading") or sl == "title":
        return "heading"
    stripped = text.strip()
    letters = re.sub(r"[^A-Za-z]", "", stripped)
    if stripped and len(stripped) <= 40 and letters and letters.isupper():
        return "heading"
    return "text"


# --------------------------------------------------------------------------- Parsing
def _lines_to_paragraphs(lines: list[str]) -> list[dict]:
    """Merge wrapped lines (common in PDFs) back into logical paragraphs."""
    merged: list[str] = []
    for raw in lines:
        line = PUA_BULLET.sub("• ", raw.strip())  # Symbol-font bullets from Word PDFs
        if not line:
            continue
        prev = merged[-1] if merged else None
        prev_is_head = prev is not None and len(prev) <= 40 and re.sub(r"[^A-Za-z]", "", prev).isupper()
        is_head = len(line) <= 40 and re.sub(r"[^A-Za-z]", "", line).isupper() and any(c.isalpha() for c in line)
        is_bullet = bool(BULLET_RE.match(line))
        continues = (prev is not None and not is_head and not is_bullet and not prev_is_head and (
            (BULLET_RE.match(prev) and (line[0].islower() or not re.search(r"[.!?;:]$", prev)))
            or line[0].islower()))
        if continues:
            merged[-1] = prev + " " + line
        else:
            merged.append(line)
    paras = []
    for i, t in enumerate(merged):
        letters = re.sub(r"[^A-Za-z]", "", t)
        kind = "bullet" if BULLET_RE.match(t) else (
            "heading" if len(t) <= 40 and letters and letters.isupper() else "text")
        paras.append({"id": f"p{i}", "text": t, "kind": kind})
    return paras


def parse_resume(path: Path) -> dict:
    ext = path.suffix.lower()
    if ext == ".docx":
        try:
            doc = Document(str(path))
        except Exception as e:
            raise ValueError(f"Couldn't open the Word file (is it a real .docx and not open/locked?): {e}")
        paras = []
        for i, p in enumerate(_docx_paragraphs(doc)):
            text = _p_text(p)
            paras.append({"id": f"p{i}", "text": text, "kind": _docx_kind(p, text) if text.strip() else "empty"})
    elif ext == ".pdf":
        import pdfplumber
        lines = []
        with pdfplumber.open(str(path)) as pdf:
            for page in pdf.pages:
                lines.extend((page.extract_text(x_tolerance=1.5) or "").splitlines())
        paras = _lines_to_paragraphs(lines)
        if not paras:
            raise ValueError("No text found in the PDF — it may be a scanned image. Use a .docx or text-based PDF.")
    else:  # .txt / .md
        paras = _lines_to_paragraphs(path.read_text(encoding="utf-8", errors="replace").splitlines())

    # the first line is the candidate's name, not a section heading
    first = next((p for p in paras if p["text"].strip()), None)
    if first and first["kind"] == "heading":
        first["kind"] = "text"
    # annotate section (nearest heading above) for the review UI
    section = "Header"
    for p in paras:
        if p["kind"] == "heading":
            section = p["text"].strip().title()
        p["section"] = section
    return {"paragraphs": paras, "source_type": ext.lstrip(".")}


# --------------------------------------------------------------------------- Export
def _safe(s: str, n: int = 40) -> str:
    s = re.sub(r"[^\w\s-]", "", s or "").strip()
    return re.sub(r"\s+", "_", s)[:n].strip("_")


def output_path(out_dir: Path, company: str, role: str) -> Path:
    base = "Resume" + "".join(f"_{x}" for x in (_safe(company), _safe(role)) if x)
    p = out_dir / f"{base}.docx"
    n = 2
    while p.exists():
        p = out_dir / f"{base}_{n}.docx"
        n += 1
    return p


def export_docx(source: Path, source_type: str, paragraphs: list[dict],
                edits: dict[str, str], dest: Path) -> Path:
    """edits: {paragraph_id: new_text} for the accepted changes only."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if source_type == "docx":
        tmp = dest.with_suffix(".tmp.docx")
        shutil.copyfile(source, tmp)
        doc = Document(str(tmp))
        ps = _docx_paragraphs(doc)
        for pid, new in edits.items():
            idx = int(pid[1:])
            if 0 <= idx < len(ps):
                _apply_text(ps[idx], new)
        doc.save(str(dest))
        tmp.unlink(missing_ok=True)
        return dest
    return _build_clean_docx([{**p, "text": edits.get(p["id"], p["text"])} for p in paragraphs], dest)


def _bottom_border(paragraph) -> None:
    ppr = paragraph._p.get_or_add_pPr()
    bdr = OxmlElement("w:pBdr")
    b = OxmlElement("w:bottom")
    for k, v in (("val", "single"), ("sz", "6"), ("space", "1"), ("color", "808080")):
        b.set(qn(f"w:{k}"), v)
    bdr.append(b)
    ppr.append(bdr)


def _build_clean_docx(paras: list[dict], dest: Path) -> Path:
    doc = Document()
    for s in doc.sections:
        s.top_margin = s.bottom_margin = Inches(0.6)
        s.left_margin = s.right_margin = Inches(0.7)
    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(10.5)
    normal.paragraph_format.space_after = Pt(2)

    first_heading = next((i for i, p in enumerate(paras) if p["kind"] == "heading"), len(paras))
    for i, p in enumerate(paras):
        text = p["text"].strip()
        if not text:
            continue
        if i == 0:  # name
            para = doc.add_paragraph()
            para.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r = para.add_run(text)
            r.bold = True
            r.font.size = Pt(18)
        elif i < first_heading:  # contact lines
            para = doc.add_paragraph(text)
            para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        elif p["kind"] == "heading":
            para = doc.add_paragraph()
            para.paragraph_format.space_before = Pt(10)
            para.paragraph_format.space_after = Pt(4)
            r = para.add_run(text.upper())
            r.bold = True
            r.font.size = Pt(11.5)
            r.font.color.rgb = RGBColor(0x1F, 0x3A, 0x5F)
            _bottom_border(para)
        elif p["kind"] == "bullet":
            para = doc.add_paragraph(BULLET_RE.sub("", text), style="List Bullet")
            para.paragraph_format.space_after = Pt(1)
        else:
            doc.add_paragraph(text)
    doc.save(str(dest))
    return dest
