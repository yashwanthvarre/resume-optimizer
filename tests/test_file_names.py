"""File names: First_Last_Company_Role_Resume / _Cover_Letter / _Application, plus title/author metadata (AI mocked)."""
import os, sys, tempfile, zipfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["ANTHROPIC_API_KEY"] = "test"
_home = tempfile.mkdtemp(); os.environ["HOME"] = os.environ["USERPROFILE"] = _home
from docx import Document
from fastapi.testclient import TestClient
import app as appmod
from ro import analyzer, pdf_export as P, resume_io as R
sys.path.insert(0, str(Path(__file__).parent))
from test_e2e_data import JD, CH, COVER

ROLE = {"role": JD["role"]}
analyzer._call_tool = lambda s, u, tool, mt: {"record_jd": {**JD, **ROLE}, "record_changes": CH, "record_cover_letter": COVER}[tool["name"]]
SRC = (Path(__file__).parent / "sample_resume.docx").resolve()
c = TestClient(appmod.app)
LETTER = {"greeting": "Dear Hiring Team,", "closing": "Sincerely,", "signature": "Alex Sample",
          "paragraphs": ["I build Python services on AWS for teams that care about reliability and clear APIs."]}


def stem(header, role, kind="Resume", company=None):
    return R.file_stem(R.name_words(header), R.role_words(role), kind, R.company_words(company))


def test_names():
    assert stem("YASHWANTH VARRE", "Software Engineer") == "Yashwanth_Varre_Software_Engineer_Resume"
    assert stem("YASHWANTH VARRE", "Software Engineer", "Cover_Letter") == "Yashwanth_Varre_Software_Engineer_Cover_Letter"
    assert stem("YASHWANTH VARRE", "", "Cover_Letter") == "Yashwanth_Varre_Cover_Letter"
    assert stem("Yashwanth Kumar Varre", "Software Engineer") == "Yashwanth_Kumar_Varre_Software_Engineer_Resume"
    assert stem("MARY-JANE O'BRIEN", "") == "Mary-Jane_OBrien_Resume"
    assert stem("José Núñez, PhD", "Data Scientist") == "Jose_Nunez_Data_Scientist_Resume"
    assert stem("Jane Doe | jane@doe.dev | 555-010-2000", "Engineer") == "Jane_Doe_Engineer_Resume"
    assert stem("Ronald McDonald", "devops engineer") == "Ronald_McDonald_Devops_Engineer_Resume"
    assert stem("John Smith III", "SDE II") == "John_Smith_III_SDE_II_Resume"


def test_roles():
    assert R.role_words("Software Engineer II (Remote) - R12345") == ["Software", "Engineer", "II"]
    assert R.role_words("Senior Backend Engineer, Payments") == ["Senior", "Backend", "Engineer"]
    assert R.role_words("Staff Machine Learning Engineer at Globex") == ["Staff", "Machine", "Learning", "Engineer"]
    assert R.role_words("Frontend/Backend Engineer - Hybrid") == ["Frontend", "Backend", "Engineer"]
    assert R.role_words("[Remote] Platform Engineer REQ-2291") == ["Platform", "Engineer"]
    assert R.role_words("C++ Developer") == ["CPP", "Developer"]
    assert R.role_words("Principal Distinguished Senior Lead Staff Platform Reliability Engineer") == \
        ["Principal", "Distinguished", "Senior", "Lead", "Staff", "Platform"]      # max 6 words
    assert R.role_words("Not specified") == [] and R.role_words("") == []
    assert stem("Jane Doe", "Not specified") == "Jane_Doe_Resume"


def test_companies():
    assert stem("YASHWANTH VARRE", "Software Engineer", company="Acme") == "Yashwanth_Varre_Acme_Software_Engineer_Resume"
    assert stem("Jane Doe", "Engineer", "Cover_Letter", "Acme") == "Jane_Doe_Acme_Engineer_Cover_Letter"
    assert stem("Jane Doe", "Engineer", "Application", "Acme") == "Jane_Doe_Acme_Engineer_Application"
    assert stem("Jane Doe", "", company="Acme") == "Jane_Doe_Acme_Resume"
    for raw, want in [("Acme, Inc.", ["Acme"]), ("Acme Inc", ["Acme"]), ("Acme LLC", ["Acme"]),
                      ("Globex Corporation", ["Globex"]), ("Initech Holdings Co. Ltd.", ["Initech", "Holdings"]),
                      ("Siemens AG", ["Siemens"]), ("Banco Santander S.A.", ["Banco", "Santander"]),
                      ("Bosch GmbH", ["Bosch"]), ("Barclays PLC", ["Barclays"]), ("Baker McKenzie LLP", ["Baker", "McKenzie"]),
                      ("Acme Limited", ["Acme"]), ("Nestlé S.A.", ["Nestle"]), ("ACME CORP", ["Acme"]),
                      ("IBM", ["IBM"]), ("OpenAI", ["OpenAI"]), ("Johnson & Johnson", ["Johnson", "Johnson"]),
                      ("Acme (formerly Initech)", ["Acme"]), ("Alpha Beta Gamma Delta", ["Alpha", "Beta", "Gamma"]),
                      ("AT&T Inc.", ["AT", "T"])]:
        assert R.company_words(raw) == want, (raw, R.company_words(raw))
    for none in ("Not specified", "unknown", "N/A", "", None, "  ", "Inc."):
        assert R.company_words(none) == [], none
    assert stem("", "Engineer", "Cover_Letter", "Acme") == "Cover_Letter"           # no name: just the kind


def test_trim_order():
    name, comp = ["Aaaaaaaaaa", "Mmmmmmmmmm", "Zzzzzzzzzz"], ["Cccccccccc", "Dddddddddd", "Eeeeeeeeee"]
    role = ["Rrrrrrrrrr", "Ssssssssss", "Tttttttttt"]
    full = R.file_stem(name, role, "Resume", comp)
    assert len(full) <= R.MAX_STEM and full.startswith("Aaaaaaaaaa_Mmmmmmmmmm_Zzzzzzzzzz_Cccccccccc_Dddddddddd_Eeeeeeeeee_")
    long_role = role + ["Uuuuuuuuuu", "Vvvvvvvvvv", "Wwwwwwwwww"]
    s = R.file_stem(name, long_role, "Resume", comp)                 # role words go first
    assert len(s) <= R.MAX_STEM and "Eeeeeeeeee" in s and "Wwwwwwwwww" not in s and s.endswith("_Resume"), s
    big = ["X" * 20, "Y" * 20, "Z" * 20]
    s = R.file_stem(name, role, "Cover_Letter", big)                  # then company words, keeping one
    assert s == "Aaaaaaaaaa_Mmmmmmmmmm_Zzzzzzzzzz_" + "X" * 20 + "_Cover_Letter", s
    s = R.file_stem(["A" * 25, "M" * 25, "Z" * 25], role, "Resume", ["Acme", "Corp"])   # then middle names
    assert s == "A" * 25 + "_" + "Z" * 25 + "_Acme_Resume", s
    s = R.file_stem(["A" * 40, "Z" * 30], role, "Resume", ["Acme"])   # last resort: the company goes too
    assert len(s) <= R.MAX_STEM and s.startswith("A" * 40), s


def test_fallbacks_and_limits():
    assert stem("jane@doe.dev | 555-010-2000", "Engineer") == "Resume"            # no name found
    assert stem("", "Engineer", "Cover_Letter") == "Cover_Letter"
    assert stem("Summary of qualifications for the senior engineering role", "Engineer") == "Resume"
    long = R.file_stem(["Aaaaaaaaaaaaaaaaaaaa", "Bbbbbbbbbbbbbbbbbbbb", "Cccccccccccccccccccc"],
                       R.role_words("Principal Platform Reliability Engineering Manager"), "Resume")
    assert len(long) <= R.MAX_STEM and long.endswith("_Resume") and long.startswith("Aaaa"), long
    for s in (long, stem("MARY-JANE O'BRIEN", "C# Engineer (Remote)")):
        assert all(ch.isalnum() or ch in "_-" for ch in s) and "__" not in s and not s.endswith("_"), s
    out = Path(tempfile.mkdtemp())
    (out / "Jane_Doe_Resume.pdf").write_text("x")
    assert [p.name for p in R.output_pair(out, "Jane_Doe_Resume")] == ["Jane_Doe_Resume_2.docx", "Jane_Doe_Resume_2.pdf"]
    (out / "Jane_Doe_Resume_2.docx").write_text("x")
    assert R.output_pair(out, "Jane_Doe_Resume")[1].name == "Jane_Doe_Resume_3.pdf"
    assert R.output_path(out, "Jane_Doe_Resume", ".pdf").name == "Jane_Doe_Resume_2.pdf"


def session(src=SRC):
    sid = c.post("/api/resume/load", json={"path": str(src)}).json()["session_id"]
    c.post("/api/analyze", json={"session_id": sid, "jd_text": "x" * 200})
    return sid


def test_export_names_and_metadata():
    c.post("/api/settings", json={"file_format": "both" if P.converter() else "docx", "name_override": ""})
    sid, out = session(), Path(tempfile.mkdtemp())
    assert c.post("/api/file_names", json={"session_id": sid}).json() == {
        "resume": "Alex_Sample_Globex_Backend_Engineer_Resume", "cover": "Alex_Sample_Globex_Backend_Engineer_Cover_Letter",
        "zip": "Alex_Sample_Globex_Backend_Engineer_Application", "name_found": True, "from_settings": False}
    r = c.post("/api/export", json={"session_id": sid, "accepted": [], "output_dir": str(out), "cover_letter": LETTER}).json()
    assert not r["notices"], r["notices"]
    names = sorted(p.name for p in out.iterdir())
    want = ["Alex_Sample_Globex_Backend_Engineer_Resume", "Alex_Sample_Globex_Backend_Engineer_Cover_Letter"]
    exts = [".docx", ".pdf"] if P.converter() else [".docx"]
    assert names == sorted(w + e for w in want for e in exts), names
    assert r["zip"]["file_name"] == "Alex_Sample_Globex_Backend_Engineer_Application.zip"
    props = Document(str(out / "Alex_Sample_Globex_Backend_Engineer_Resume.docx")).core_properties
    assert props.title == "Alex Sample Globex Backend Engineer Resume" and props.author == "Alex Sample"
    assert Document(str(out / "Alex_Sample_Globex_Backend_Engineer_Cover_Letter.docx")).core_properties.title == \
        "Alex Sample Globex Backend Engineer Cover Letter"
    if P.converter():
        import pdfplumber
        with pdfplumber.open(str(out / "Alex_Sample_Globex_Backend_Engineer_Resume.pdf")) as pdf:
            assert pdf.metadata.get("Title") == "Alex Sample Globex Backend Engineer Resume", pdf.metadata
            assert pdf.metadata.get("Author") == "Alex Sample", pdf.metadata
    # a second export never overwrites: _2 on both files of the pair
    r2 = c.post("/api/export", json={"session_id": sid, "accepted": [], "output_dir": str(out)}).json()
    assert r2["file_name"].startswith("Alex_Sample_Globex_Backend_Engineer_Resume_2.")


def test_override_and_no_name():
    c.post("/api/settings", json={"file_format": "docx", "name_override": "yashwanth varre"})
    assert c.get("/api/config").json()["name_override"] == "yashwanth varre"
    sid, out = session(), Path(tempfile.mkdtemp())
    n = c.post("/api/file_names", json={"session_id": sid}).json()
    assert n["resume"] == "Yashwanth_Varre_Globex_Backend_Engineer_Resume" and n["from_settings"]
    r = c.post("/api/export", json={"session_id": sid, "accepted": [], "output_dir": str(out)}).json()
    assert r["file_name"] == "Yashwanth_Varre_Globex_Backend_Engineer_Resume.docx"
    c.post("/api/settings", json={"name_override": ""})
    txt = Path(tempfile.mkdtemp()) / "resume.txt"
    txt.write_text("jane@doe.dev | 555-010-2000\nSUMMARY\nBackend engineer building Python services on AWS.\n")
    sid = session(txt)
    r = c.post("/api/export", json={"session_id": sid, "accepted": [], "output_dir": str(out)}).json()
    assert r["file_name"] == "Resume.docx", r["file_name"]
    assert any("Couldn't find your name" in x for x in r["notices"]), r["notices"]


def test_no_role():
    ROLE["role"] = "Not specified"
    try:
        c.post("/api/settings", json={"file_format": "docx", "name_override": ""})
        sid = session()
        assert c.post("/api/file_names", json={"session_id": sid}).json()["resume"] == "Alex_Sample_Globex_Resume"
    finally:
        ROLE["role"] = JD["role"]


def test_no_company():
    ROLE["company"] = "Not specified"
    try:
        c.post("/api/settings", json={"file_format": "docx", "name_override": ""})
        sid = session()
        assert c.post("/api/file_names", json={"session_id": sid}).json() == {
            "resume": "Alex_Sample_Backend_Engineer_Resume", "cover": "Alex_Sample_Backend_Engineer_Cover_Letter",
            "zip": "Alex_Sample_Backend_Engineer_Application", "name_found": True, "from_settings": False}
    finally:
        ROLE.pop("company")


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn(); print("ok", name)
    print("ALL FILE NAME TESTS PASSED")
