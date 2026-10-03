"""PDF output: converter choice, fallbacks, and an ATS-safe PDF (AI mocked). The real conversion checks
run when LibreOffice is installed and are skipped otherwise."""
import os, sys, re, tempfile, zipfile
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["ANTHROPIC_API_KEY"] = "test"
_home = tempfile.mkdtemp(); os.environ["HOME"] = os.environ["USERPROFILE"] = _home
from fastapi.testclient import TestClient
import app as appmod
from ro import analyzer, pdf_export as P, resume_io as R
sys.path.insert(0, str(Path(__file__).parent))
from test_e2e_data import JD, CH, COVER

analyzer._call_tool = lambda s, u, tool, mt: {"record_jd": JD, "record_changes": CH, "record_cover_letter": COVER}[tool["name"]]
SRC = (Path(__file__).parent / "sample_resume.docx").resolve()
c = TestClient(appmod.app)
HAVE_LO = bool(P.find_soffice())


def session():
    sid = c.post("/api/resume/load", json={"path": str(SRC)}).json()["session_id"]
    res = c.post("/api/analyze", json={"session_id": sid, "jd_text": "x" * 200}).json()
    accepted = [{"target_id": x["target_id"], "new_text": x["new_text"]} for x in res["changes"]]
    return sid, accepted


def export(fmt, **body):
    c.post("/api/settings", json={"file_format": fmt})
    out_dir = Path(tempfile.mkdtemp())
    sid, accepted = session()
    r = c.post("/api/export", json={"session_id": sid, "accepted": accepted, "output_dir": str(out_dir),
                                    "company": "Globex", "role": "Backend Engineer", **body})
    assert r.status_code == 200, r.text
    return r.json(), out_dir, sid, accepted


def test_converter_choice():
    with mock.patch.object(P, "find_soffice", return_value="/x/soffice"), mock.patch.object(P, "has_word", return_value=True):
        assert P.converter() == "libreoffice"
    with mock.patch.object(P, "find_soffice", return_value=None), mock.patch.object(P, "has_word", return_value=True):
        assert P.converter() == "word"
    with mock.patch.object(P, "find_soffice", return_value=None), mock.patch.object(P, "has_word", return_value=False):
        assert P.converter() == ""
        try:
            P.docx_to_pdf(SRC, Path(tempfile.mkdtemp()) / "x.pdf"); raise AssertionError("should fail")
        except P.PdfError as e:
            assert "LibreOffice" in str(e) and "Microsoft Word" in str(e)
    with mock.patch.object(P.sys, "platform", "linux"):
        assert P.has_word() is False   # docx2pdf drives Word: macOS / Windows only


def test_no_converter_falls_back_to_docx():
    with mock.patch.object(P, "find_soffice", return_value=None), mock.patch.object(P, "has_word", return_value=False):
        cfg = c.get("/api/config").json()
        assert cfg["pdf_converter"] == "" and "LibreOffice" in cfg["pdf_missing"]
        out, out_dir, *_ = export("pdf")
    assert out["format"] == "docx" and out["file_name"].endswith(".docx")
    assert any("Saved as .docx instead" in n for n in out["notices"]), out["notices"]
    assert sorted(p.suffix for p in out_dir.iterdir()) == [".docx"]


def test_failed_conversion_keeps_docx():
    with mock.patch.object(P, "converter", return_value="libreoffice"), \
            mock.patch.object(P, "docx_to_pdf", side_effect=P.PdfError("LibreOffice couldn't convert the file to PDF.")):
        out, out_dir, *_ = export("pdf")
    assert out["file_name"].endswith(".docx"), out
    assert any("couldn't convert" in n for n in out["notices"])
    assert [p.suffix for p in out_dir.iterdir()] == [".docx"]
    assert not list((appmod.config.CONFIG_DIR / "tmp").glob("*.docx")), "temporary .docx left behind"


def words(text):
    """Comparable word stream: join words hyphenated across a line, drop bullet glyphs and spacing."""
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    text = re.sub(r"[-•●▪]", " ", text)
    return text.split()


def test_real_pdf_is_ats_safe():
    if not HAVE_LO:
        print("SKIP real PDF checks: LibreOffice not installed"); return
    import pdfplumber
    out, out_dir, sid, accepted = export("pdf")
    pdf = Path(out["path"])
    assert pdf.suffix == ".pdf" and pdf.exists() and out["format"] == "pdf"
    assert [p.suffix for p in out_dir.iterdir()] == [".pdf"], list(out_dir.iterdir())   # no stray .docx
    assert not list((appmod.config.CONFIG_DIR / "tmp").glob("*.docx"))
    raw = pdf.read_bytes()
    assert b"/StructTreeRoot" in raw, "PDF should be tagged"
    with pdfplumber.open(str(pdf)) as doc:
        assert len(doc.pages) == out["pages"] == 1
        text = "\n".join(p.extract_text() for p in doc.pages)
        fonts = {ch["fontname"].split("+")[-1] for p in doc.pages for ch in p.chars}
        bold = {w["text"].strip(",.") for w in doc.pages[0].extract_words(extra_attrs=["fontname"]) if "Bold" in w["fontname"]}
    assert {"EBGaramond-Regular", "EBGaramond-Bold"} <= fonts, fonts   # embedded, not substituted
    assert text.strip(), "the PDF must hold real text, not an image"
    edits = {a["target_id"]: a["new_text"] for a in accepted}
    preview = "\n".join(edits.get(p["id"], p["text"]) for p in appmod.SESSIONS[sid]["paragraphs"] if p["text"].strip())
    assert words(text) == words(preview), (words(text), words(preview))   # same words, same reading order
    assert text.lstrip().startswith("ALEX SAMPLE") and "alex@example.com" in text.split("\n")[1]
    for term in ("Python", "AWS", "CI/CD"):
        assert re.search(rf"(?<!\w){re.escape(term)}(?!\w)", text), term
    for k in ("Python", "RESTful", "APIs"):   # JD keywords are never split across a line
        assert not any(f"{k[:i]}-\n{k[i:]}" in text for i in range(2, len(k) - 1)), f"{k} hyphenated"
    assert {"Python", "AWS"} <= bold, bold


def test_formats_and_zip():
    if not HAVE_LO:
        print("SKIP format checks: LibreOffice not installed"); return
    letter = {"greeting": "Dear Hiring Team,", "closing": "Sincerely,", "signature": "Alex Sample",
              "paragraphs": ["I build Python services on AWS for teams that care about reliability and clear APIs."]}
    out, out_dir, *_ = export("both")
    names = sorted(p.name for p in out_dir.iterdir())
    assert names == ["Alex_Sample_Globex_Backend_Engineer_Resume.docx", "Alex_Sample_Globex_Backend_Engineer_Resume.pdf"], names
    assert out["file_name"].endswith(".pdf") and [f["file_name"][-4:] for f in out["files"]] == [".pdf", "docx"]
    out, out_dir, *_ = export("docx")
    assert [p.suffix for p in out_dir.iterdir()] == [".docx"] and out["format"] == "docx"
    out, out_dir, *_ = export("pdf", cover_letter=letter)
    assert out["cover"]["file_name"] == "Alex_Sample_Globex_Backend_Engineer_Cover_Letter.pdf"
    with zipfile.ZipFile(appmod.DOWNLOADS[out["zip"]["download_url"].rsplit("/", 1)[1]]) as z:
        assert sorted(z.namelist()) == ["Alex_Sample_Globex_Backend_Engineer_Cover_Letter.pdf", "Alex_Sample_Globex_Backend_Engineer_Resume.pdf"]
    out, out_dir, *_ = export("both", cover_letter=letter)
    with zipfile.ZipFile(appmod.DOWNLOADS[out["zip"]["download_url"].rsplit("/", 1)[1]]) as z:
        assert sorted(n[-4:] for n in z.namelist()) == [".pdf", ".pdf", "docx", "docx"], z.namelist()
    # the job version reports the conversion as its own step
    c.post("/api/settings", json={"file_format": "pdf"})
    sid, accepted = session()
    job = c.post("/api/jobs/export", json={"session_id": sid, "accepted": accepted, "output_dir": str(out_dir)}).json()
    assert [s["step"] for s in job["plan"]] == ["resume_docx", "resume_pdf"], job["plan"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn(); print("ok", name)
    print("ALL PDF TESTS PASSED")
