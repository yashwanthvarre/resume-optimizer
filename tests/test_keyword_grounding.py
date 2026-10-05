"""Keywords must come from the JD: anything the model invents is dropped (AI mocked)."""
import os, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["ANTHROPIC_API_KEY"] = "test"
_home = tempfile.mkdtemp(); os.environ["HOME"] = os.environ["USERPROFILE"] = _home
from fastapi.testclient import TestClient
import app as appmod
from ro import analyzer

JD_TEXT = ("Software Engineer, Dublin OH (Hybrid). You will design and build RESTful APIs in Java and Spring Boot, "
           "write unit tests, and work in an Agile team. Requirements: 3+ years with Java, experience with SQL "
           "databases and CI/CD pipelines. Nice to have: AWS, Kubernetes.")
kw = lambda t, **k: {"term": t, "importance": "preferred", "category": "hard_skill", **k}
MODEL = {"company": "OCLC", "role": "Software Engineer", "summary": "Java APIs", "patterns": [],
         "keywords": [kw("Java"), kw("Spring Boot"), kw("unit test"),               # singular of "unit tests": kept
                      kw("RESTful API"), kw("sql databases"),                        # plural / case: kept
                      kw("CI/CD pipeline"), kw("AWS"), kw("k8s", variants=["Kubernetes"]),  # only the variant is in the JD
                      kw("Legacy system maintenance"), kw("Large-scale datasets"),   # invented: dropped
                      kw("Cross-functional collaboration"), kw("Python"),
                      kw("Agile", variants=["Scrum", "Agile methodologies", "agl"]),
                      kw("java"), kw("  ")]}
analyzer._call_tool = lambda s, u, tool, mt: MODEL

jd = analyzer.analyze_jd(JD_TEXT)
terms = [k["term"] for k in jd["keywords"]]
assert terms == ["Java", "Spring Boot", "unit test", "RESTful API", "sql databases", "CI/CD pipeline", "AWS",
                 "Kubernetes", "Agile"], terms
assert jd["dropped_keywords"] == ["Legacy system maintenance", "Large-scale datasets",
                                  "Cross-functional collaboration", "Python"], jd["dropped_keywords"]
by = {k["term"]: k for k in jd["keywords"]}
assert by["Kubernetes"]["variants"] == ["k8s"], by["Kubernetes"]        # the JD's spelling wins; abbreviation kept
assert by["Agile"]["variants"] == ["agl"], by["Agile"]                  # a different skill or broader phrase isn't a variant
for t in terms:
    assert analyzer.mentions(JD_TEXT, t), t

# end to end: the dropped terms never reach the UI, the session, later prompts or keyword gaps
CH = {"overall_assessment": "", "suggestions": [], "changes": [],
      "keyword_gaps": [{"term": "Python", "reason": "Not in your resume."},
                       {"term": "AWS", "reason": "Not in your resume."}]}
seen = []
def fake(s, u, tool, mt):
    seen.append(u)
    return {"record_jd": MODEL, "record_changes": CH}[tool["name"]]
analyzer._call_tool = fake
c = TestClient(appmod.app)
sid = c.post("/api/resume/load", json={"path": str((Path(__file__).parent / "sample_resume.docx").resolve())}).json()["session_id"]
res = c.post("/api/analyze", json={"session_id": sid, "jd_text": JD_TEXT}).json()
assert [k["term"] for k in res["jd"]["keywords"]] == terms
assert "dropped_keywords" not in res["jd"]
assert [g["term"] for g in res["keyword_gaps"]] == ["AWS"], res["keyword_gaps"]
assert "Legacy system maintenance" not in seen[-1] and "Cross-functional" not in seen[-1]

# categories: the JD names the item, so the keyword is the item ("React"), never the category ("modern frameworks")
JD2 = ("Build web apps using modern frameworks such as React and Angular. Familiarity with cloud platforms, AWS "
       "preferred. Experience with state management libraries (Redux or Zustand). Experience with design systems "
       "and Storybook. Knowledge of database systems. Strong proficiency in Node.js.")
MODEL2 = {"company": "X", "role": "Y", "summary": "", "patterns": [],
          "keywords": [kw("modern frameworks", importance="required"), kw("React"), kw("cloud platforms"), kw("AWS"),
                       kw("state management libraries"), kw("Redux"), kw("design systems"), kw("Storybook"),
                       kw("database systems"), kw("Node.js")]}
analyzer._call_tool = lambda s, u, tool, mt: MODEL2
jd2 = analyzer.analyze_jd(JD2)
terms2 = [k["term"] for k in jd2["keywords"]]
assert terms2 == ["React", "AWS", "Redux", "design systems", "Storybook", "database systems", "Node.js",
                  "Angular", "Zustand"], terms2                                 # Angular, Zustand recovered from the JD
assert [d.split(" (")[0] for d in jd2["dropped_keywords"]] == ["modern frameworks", "cloud platforms",
                                                                "state management libraries"], jd2["dropped_keywords"]
assert {k["term"]: k for k in jd2["keywords"]}["Angular"]["importance"] == "required"  # inherits the category's

# edit tags are JD keywords the edit contains, never the model's free text
ch = [{"original_text": "Built web apps in React.", "new_text": "Built web apps in React and Angular on AWS.",
       "jd_keywords": ["modern frameworks", "React", "Angular"]},
      {"original_text": "Wrote APIs.", "new_text": "Wrote Node.js APIs.", "jd_keywords": ["backend frameworks"]}]
analyzer.tag_changes(ch, jd2)
assert ch[0]["jd_keywords"] == ["React", "AWS", "Angular"], ch[0]       # React was tagged; AWS and Angular are new
assert ch[1]["jd_keywords"] == ["Node.js"], ch[1]
print("keyword grounding OK")
