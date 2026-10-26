"""Ask Claude for any change in your own words: edits anywhere, built on accepted ones, nothing invented (AI mocked)."""
import os, sys, tempfile, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["ANTHROPIC_API_KEY"] = "test"
_home = tempfile.mkdtemp(); os.environ["HOME"] = os.environ["USERPROFILE"] = _home
from fastapi.testclient import TestClient
import app as appmod
from ro import analyzer
sys.path.insert(0, str(Path(__file__).parent))
from test_e2e_data import JD, CH, COVER, JD_TEXT, instruct_edits

prompts, calls, OVERRIDE = {}, [], []
def fake(s, u, tool, mt):
    prompts[tool["name"]] = u; calls.append(tool["name"])
    if tool["name"] == "record_instruction_edits":
        return OVERRIDE.pop() if OVERRIDE else instruct_edits(u)
    return {"record_jd": JD, "record_changes": CH, "record_cover_letter": COVER}[tool["name"]]
analyzer._call_tool = fake

c = TestClient(appmod.app)
src = (Path(__file__).parent / "sample_resume.docx").resolve()
sid = c.post("/api/resume/load", json={"path": str(src)}).json()["session_id"]
res = c.post("/api/analyze", json={"session_id": sid, "jd_text": JD_TEXT}).json()
accepted = [{"target_id": x["target_id"], "new_text": x["new_text"]} for x in res["changes"]]
p8 = next(x for x in res["changes"] if x["target_id"] == "p8")
ASK = "show I led code reviews for 3 teammates, and add that I mentored new hires"
body = lambda **kw: {"session_id": sid, "instruction": ASK, "accepted": accepted, **kw}

# ---- input validation (no AI call)
n0 = len(calls)
assert c.post("/api/instruct", json=body(instruction="  ")).status_code == 400
sid2 = c.post("/api/resume/load", json={"path": str(src)}).json()["session_id"]
assert c.post("/api/instruct", json=body(session_id=sid2)).status_code == 400  # not analyzed yet
assert len(calls) == n0, "validation must not call Claude"
print("ok: input validation")

# ---- one call; the request, the accepted text and the rules reach Claude
d = c.post("/api/instruct", json=body())
assert d.status_code == 200, d.text
d = d.json()
assert calls[n0:] == ["record_instruction_edits"], calls[n0:]
u = prompts["record_instruction_edits"]
assert ASK in u and "<request>" in u and "Never inflate" in u and p8["new_text"] in u, "request + accepted edits in prompt"
assert d["reply"].startswith("Reworded"), d
[ch] = d["changes"]
assert ch["target_id"] == "p8" and ch["source"] == "ask" and ch["from_input"] == ASK, ch
assert ch["id"].startswith("a") and ch["original_text"] == p8["original_text"], ch
lines = ch["new_text"].split("\n")
assert len(lines) == 2 and "Mentored two new hires" in lines[1], lines        # the new bullet merged in
lead = analyzer.BULLET_LEAD.match(p8["original_text"]).group(0)
assert all(x.startswith(lead) for x in lines), lines
assert any("p999" in x for x in d["dropped"]), d["dropped"]
print("ok: edit + new bullet ->", lines)

# ---- the number the request gives is known; one it doesn't is flagged; a lost keyword is flagged
assert not any("number" in w for w in ch["warnings"]), ch["warnings"]          # "3" is in the request
d = c.post("/api/instruct", json=body(instruction="show I led code reviews")).json()
assert any("3" in w for w in d["changes"][0]["warnings"]), d["changes"][0]["warnings"]
OVERRIDE.append({"reply": "Shortened it.", "changes": [{"target_id": "p7", "new_text": "Worked on deployments.", "type": "tighten", "reason": "r"}]})
d = c.post("/api/instruct", json=body(instruction="shorten the AWS bullet")).json()
assert any("Drops" in w and "AWS" in w for w in d["changes"][0]["warnings"]), d["changes"][0]["warnings"]
print("ok: warnings")

# ---- JD spelling enforced; keywords the line carries are tagged; an edit equal to the accepted text is dropped
term = JD["keywords"][0]["term"]
p7 = next(x for x in res["changes"] if x["target_id"] == "p7")
OVERRIDE.append({"reply": "Done.", "changes": [{"target_id": "p6", "new_text": f"Built {term.lower()} services in Flask that handled customer orders.", "type": "reword", "reason": "r"},
                                               {"target_id": "p7", "new_text": p7["new_text"], "type": "reword", "reason": "same"}]})
d = c.post("/api/instruct", json=body(instruction="say it was python")).json()
[ch] = d["changes"]
assert f"Built {term} services" in ch["new_text"] and term in ch["jd_keywords"], ch
assert any("p7" in x and "doesn't change" in x for x in d["dropped"]), d["dropped"]
print("ok: spelling / tags / unchanged")

# ---- nothing to do is a reply, not an error
OVERRIDE.append({"reply": "Your resume doesn't show Kubernetes, so I didn't add it.", "changes": []})
r = c.post("/api/instruct", json=body(instruction="say I'm a Kubernetes expert"))
assert r.status_code == 200 and r.json()["changes"] == [] and "Kubernetes" in r.json()["reply"], r.text

# ---- the job endpoint runs the same work with progress
j = c.post("/api/jobs/instruct", json=body()).json()
assert [p["step"] for p in j["plan"]] == ["edit", "check"], j
for _ in range(100):
    snap = c.get(f"/api/jobs/{j['job_id']}").json()
    if snap["status"] != "running":
        break
    time.sleep(0.05)
assert snap["status"] == "done" and len(snap["result"]["changes"]) == 1, snap
print("ok: job endpoint")
print("ALL INSTRUCT TESTS PASSED")
