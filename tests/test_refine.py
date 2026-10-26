"""Ask Claude to rewrite one line of an edit: 3 options, keyword kept, nothing invented (AI mocked)."""
import os, sys, json, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["ANTHROPIC_API_KEY"] = "test"
_home = tempfile.mkdtemp(); os.environ["HOME"] = os.environ["USERPROFILE"] = _home
from fastapi.testclient import TestClient
import app as appmod
from ro import analyzer
sys.path.insert(0, str(Path(__file__).parent))
from test_e2e_data import JD, CH, COVER, JD_TEXT, rewrites

prompts, calls, OVERRIDE = {}, [], []
def fake(s, u, tool, mt):
    prompts[tool["name"]] = u; calls.append(tool["name"])
    if tool["name"] == "record_rewrites":
        return OVERRIDE.pop() if OVERRIDE else rewrites(u)
    return {"record_jd": JD, "record_changes": CH, "record_cover_letter": COVER}[tool["name"]]
analyzer._call_tool = fake

c = TestClient(appmod.app)
src = (Path(__file__).parent / "sample_resume.docx").resolve()
sid = c.post("/api/resume/load", json={"path": str(src)}).json()["session_id"]
res = c.post("/api/analyze", json={"session_id": sid, "jd_text": JD_TEXT}).json()
accepted = [{"target_id": x["target_id"], "new_text": x["new_text"]} for x in res["changes"]]
ch = next(x for x in res["changes"] if x["target_id"] == "p7")
kw = next(k for k in ch["jd_keywords"] if analyzer.mentions(ch["new_text"], k))
body = lambda **kw_: {"session_id": sid, "target_id": "p7", "line": ch["new_text"], "original": ch["original_text"],
                      "keywords": [kw], "instruction": "the keyword feels forced here", "accepted": accepted, **kw_}

# ---- input validation (no AI call)
n0 = len(calls)
assert c.post("/api/refine_change", json=body(instruction="  ")).status_code == 400
assert c.post("/api/refine_change", json=body(line="")).status_code == 400
assert c.post("/api/refine_change", json=body(target_id="p999")).status_code == 400
sid2 = c.post("/api/resume/load", json={"path": str(src)}).json()["session_id"]
assert c.post("/api/refine_change", json=body(session_id=sid2)).status_code == 400  # not analyzed yet
assert len(calls) == n0, "validation must not call Claude"
print("ok: input validation")

# ---- 3 options in ONE call; the unchanged one is dropped; keyword, instruction and rules reach Claude
n0 = len(calls)
d = c.post("/api/refine_change", json=body())
assert d.status_code == 200, d.text
d = d.json()
assert calls[n0:] == ["record_rewrites"], calls[n0:]
u = prompts["record_rewrites"]
assert "the keyword feels forced here" in u and json.dumps(kw) in u and "<original>" in u and "Never inflate" in u
assert len(d["options"]) == 3 and all(o["note"] for o in d["options"]), d
assert any("doesn't change anything" in x for x in d["dropped"]), d["dropped"]
texts = [o["text"] for o in d["options"]]
lead = analyzer.BULLET_LEAD.match(ch["new_text"]).group(0)
assert all(t.startswith(lead) for t in texts), texts                       # bullet symbol kept
print("ok: 3 options ->", [o["note"] for o in d["options"]])

# ---- honesty checks: a new number and a dropped keyword are flagged; one that keeps both isn't
flag = {o["note"]: o["warnings"] for o in d["options"]}
assert any("40" in w for w in flag["Adds scope"]), flag
kept = [o for o in d["options"] if analyzer.mentions(o["text"], kw)]
assert all(not any("Drops" in w for w in o["warnings"]) for o in kept)
for o in d["options"]:
    if not analyzer.mentions(o["text"], kw):
        assert any(f"Drops {kw}" in w for w in o["warnings"]), o
print("ok: warnings", {k: len(v) for k, v in flag.items()})

# ---- the JD's exact spelling is enforced, quotes and line breaks stripped, duplicates dropped
term = JD["keywords"][0]["term"]
OVERRIDE.append({"options": [{"text": f'"Built {term.lower()} services\nfor billing"', "note": "a"},
                             {"text": f"Built {term} services for billing", "note": "dup"},
                             {"text": "", "note": "empty"}]})
d = c.post("/api/refine_change", json=body()).json()
assert [o["text"] for o in d["options"]] == [lead + f"Built {term} services for billing"], d
assert any("repeats" in x for x in d["dropped"]) and any("empty" in x for x in d["dropped"]), d["dropped"]
print("ok: spelling / cleanup / duplicates")

# ---- nothing usable is an error, not an empty list
OVERRIDE.append({"options": [{"text": ch["new_text"], "note": "same"}]})
r = c.post("/api/refine_change", json=body())
assert r.status_code == 502 and "usable" in r.json()["detail"], r.text

# ---- a new bullet (no original) says so; the job endpoint runs the same work with progress
d = c.post("/api/refine_change", json=body(original="", line="• Shipped dashboards with contextAPI")).json()
assert "a new bullet added under it" in prompts["record_rewrites"] and "<original>" not in prompts["record_rewrites"]
assert all(o["text"].startswith("• ") for o in d["options"]), d
j = c.post("/api/jobs/refine_change", json=body()).json()
assert [p["step"] for p in j["plan"]] == ["rewrite", "check"], j
import time
for _ in range(100):
    snap = c.get(f"/api/jobs/{j['job_id']}").json()
    if snap["status"] != "running":
        break
    time.sleep(0.05)
assert snap["status"] == "done" and len(snap["result"]["options"]) == 3, snap
print("ok: new bullet + job endpoint")
print("ALL REFINE TESTS PASSED")
