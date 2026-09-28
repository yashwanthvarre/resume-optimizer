"""End-to-end test of the API with the AI calls mocked."""
import os, sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["ANTHROPIC_API_KEY"] = "test"  # analyzer is mocked below
import tempfile
_home = tempfile.mkdtemp(); os.environ["HOME"] = os.environ["USERPROFILE"] = _home  # keep real config untouched
from fastapi.testclient import TestClient
import app as appmod
from ro import analyzer
from docx import Document

JD = {"company": "Globex", "role": "Backend Engineer", "summary": "Python APIs on AWS", "patterns": ["ownership"],
      "keywords": [{"term": "Python", "importance": "required", "category": "hard_skill"},
                   {"term": "REST APIs", "variants": ["RESTful APIs"], "importance": "required", "category": "hard_skill"},
                   {"term": "AWS", "importance": "required", "category": "tool"},
                   {"term": "CI/CD", "importance": "preferred", "category": "tool"},
                   {"term": "Kubernetes", "importance": "nice", "category": "tool"}]}
CH = {"overall_assessment": "Good fit.", "suggestions": [{"text": "Add Kubernetes — only if true", "reason": "JD lists it"}],
      "changes": [
        {"target_id": "p6", "new_text": "Designed and built RESTful APIs in Python and Flask that processed customer orders.", "type": "keyword", "reason": "JD asks for REST APIs", "jd_keywords": ["REST APIs"]},
        {"target_id": "p7", "new_text": "Owned AWS deployments through CI/CD and fixed production bugs, cutting incidents by 30%.", "type": "reword", "reason": "Ownership + CI/CD"},
        {"target_id": "p7", "new_text": "duplicate", "type": "reword", "reason": "dup"},
        {"target_id": "p99", "new_text": "bad id", "type": "reword", "reason": "x"},
        {"target_id": "p3", "new_text": "Backend engineer with 4 years of experience building Python REST APIs on AWS for 2M users.", "type": "summary", "reason": "mirror JD"},
        {"target_id": "p5", "new_text": "Acme Corp\tSoftware Engineer (Backend)\tJan 2022 – Present", "type": "reword", "reason": "title"},
      ]}
analyzer._call_tool = lambda s, u, tool, mt: JD if tool["name"] == "record_jd" else CH

c = TestClient(appmod.app)
src = (Path(__file__).parent / "sample_resume.docx").resolve()
# path handling: quoted, ~-relative style
r = c.post("/api/resume/load", json={"path": f'"{src}"'}); assert r.status_code == 200, r.text
sid = r.json()["session_id"]
assert c.post("/api/resume/load", json={"path": "/nope/x.docx"}).status_code == 400
r = c.post("/api/analyze", json={"session_id": sid, "jd_text": "x" * 200}); assert r.status_code == 200, r.text
res = r.json()
ids = [x["target_id"] for x in res["changes"]]
print("changes:", ids); assert ids == ["p3", "p5", "p6", "p7"]
print("warnings:", {x["target_id"]: x["warnings"] for x in res["changes"] if x["warnings"]})
# accept p5, p6, p7 (reject summary)
acc = [{"target_id": x["target_id"], "new_text": x["new_text"]} for x in res["changes"] if x["target_id"] != "p3"]
out = Path(__file__).parent / "out"; out.mkdir(exist_ok=True)
r = c.post("/api/export", json={"session_id": sid, "accepted": acc, "output_dir": str(out), "company": "Globex", "role": "Backend Engineer"})
assert r.status_code == 200, r.text
p = Path(r.json()["path"]); print("exported", p.name)
d = Document(str(p))
paras = [x for x in d.paragraphs]
for x in paras: print(repr(x.text), [(run.text, run.bold, run.italic) for run in x.runs] if x.text.startswith(("Owned","Acme")) else x.style.name)
assert paras[3].text.startswith("Software engineer with 4 years")  # rejected change untouched
assert c.get(r.json()["download_url"]).status_code == 200
print("OK")
