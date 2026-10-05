"""Cover letter + background jobs (live progress events), with the AI calls mocked."""
import os, sys, json, time, zipfile, tempfile, threading
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["ANTHROPIC_API_KEY"] = "test"
_home = tempfile.mkdtemp(); os.environ["HOME"] = os.environ["USERPROFILE"] = _home  # keep real config untouched
from fastapi.testclient import TestClient
from docx import Document
import app as appmod
from ro import analyzer, jobs, resume_io
sys.path.insert(0, str(Path(__file__).parent))
from test_e2e_data import JD, CH, COVER, JD_TEXT

CANNED = {"record_jd": JD, "record_changes": CH, "record_cover_letter": COVER}
analyzer._call_tool = lambda s, u, tool, mt: CANNED[tool["name"]]
c = TestClient(appmod.app)
c.post("/api/settings", json={"file_format": "docx"})  # these checks read the .docx; tests/test_pdf.py covers PDF
src = (Path(__file__).parent / "sample_resume.docx").resolve()
out = Path(tempfile.mkdtemp())


def final_status(evs):
    last = {}
    for e in evs:
        last[e["step"]] = e["status"]
    return last


def sse(job_id):
    """Read a job's event stream to the end → (events, end payload)."""
    evs, end, kind = [], None, "message"
    with c.stream("GET", f"/api/jobs/{job_id}/events") as r:
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
        for line in r.iter_lines():
            if line.startswith("event:"):
                kind = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                data = json.loads(line[5:])
                if kind == "end":
                    end = data
                else:
                    evs.append(data)
                kind = "message"
    return evs, end


# ---- 1. cover letter validation (pure)
text = resume_io.applied_text(resume_io.parse_resume(src)["paragraphs"], {})
v = analyzer.validate_cover_letter(COVER, text)
assert v["paragraphs"] and v["signature"] == "Alex Sample" and len(v["evidence"]) == 3
assert 200 <= v["word_count"] <= 450, v["word_count"]
assert v["warnings"] == [], v["warnings"]           # 30% is in the resume → not flagged
bad = dict(COVER, paragraphs=["I am writing to express my interest. I grew revenue 45% and led 12 people."], greeting="")
v2 = analyzer.validate_cover_letter(bad, text)
assert v2["greeting"] == "Dear Hiring Team,"
w = " ".join(v2["warnings"])
assert "45%" in w and "12" in w and "short" in w and "stock phrase" in w, v2["warnings"]
print("ok: cover letter validation")

# ---- 2. load + analyze as a job: events arrive in plan order and end with the result
sid = c.post("/api/resume/load", json={"path": str(src)}).json()["session_id"]
r = c.post("/api/jobs/analyze", json={"session_id": sid, "jd_text": JD_TEXT})
assert r.status_code == 200, r.text
job = r.json(); assert [p["step"] for p in job["plan"]] == ["resume", "analyze_jd", "propose", "validate"]
evs, end = sse(job["job_id"])
assert [e["seq"] for e in evs] == list(range(len(evs)))
order = []
for e in evs:
    if e["step"] not in order:
        order.append(e["step"])
assert order == ["resume", "analyze_jd", "propose", "validate"], order
for step in order:  # every step starts running and finishes done
    sts = [e["status"] for e in evs if e["step"] == step]
    assert sts[0] == "running" and sts[-1] == "done", (step, sts)
assert end["status"] == "done" and [x["target_id"] for x in end["result"]["changes"]] == ["p3", "p6", "p7", "p8"]
val = [e for e in evs if e["step"] == "validate"][-1]
assert "4 edits kept" in val["message"], val
print("ok: analyze job events:", [e["message"] for e in evs if e["status"] == "done"])

# reconnect (Last-Event-ID) only replays what the client hasn't seen
with c.stream("GET", f"/api/jobs/{job['job_id']}/events", headers={"Last-Event-ID": str(len(evs) - 2)}) as r:
    ids = [int(l[3:]) for l in r.iter_lines() if l.startswith("id:")]
assert ids == [len(evs) - 1], ids
# polling fallback returns the same data
snap = c.get(f"/api/jobs/{job['job_id']}?since=2").json()
assert snap["status"] == "done" and snap["events"][0]["seq"] == 2 and "result" in snap
print("ok: reconnect + polling fallback")

# ---- 3. cover letter job
accepted = [{"target_id": x["target_id"], "new_text": x["new_text"]} for x in end["result"]["changes"]]
assert c.post("/api/jobs/cover_letter", json={"session_id": "nope"}).status_code == 404
r = c.post("/api/jobs/cover_letter", json={"session_id": sid, "accepted": accepted, "tone": "formal",
                                           "hiring_manager": "Priya Shah", "why_company": "I use Globex daily"})
evs, end = sse(r.json()["job_id"])
assert end["status"] == "done", end
letter = end["result"]
assert letter["greeting"] and len(letter["paragraphs"]) == 4 and letter["word_count"] > 200
assert {e["step"] for e in evs} == {"prepare", "cover", "check"}
assert "4 selected edits" in [e for e in evs if e["step"] == "prepare"][-1]["message"]
print("ok: cover letter job")

# the prompt carries tone, manager and the *edited* resume text
seen = {}
analyzer._call_tool = lambda s, u, tool, mt: (seen.setdefault("user", u), CANNED[tool["name"]])[1]
c.post("/api/cover_letter", json={"session_id": sid, "accepted": accepted, "tone": "concise", "hiring_manager": "Priya Shah"})
assert "Priya Shah" in seen["user"] and "Concise and direct" in seen["user"] and "microservices on AWS" in seen["user"]
analyzer._call_tool = lambda s, u, tool, mt: CANNED[tool["name"]]
print("ok: cover letter prompt contents")

# ---- 4. export both → resume docx + cover letter docx + zip
r = c.post("/api/jobs/export", json={"session_id": sid, "accepted": accepted, "output_dir": str(out),
                                      "company": "Globex", "role": "Backend Engineer", "cover_letter": letter})
assert [p["step"] for p in r.json()["plan"]] == ["resume_docx", "cover_docx", "zip"]
evs, end = sse(r.json()["job_id"])
res = end["result"]; assert end["status"] == "done", end
assert Path(res["path"]).name == "Alex_Sample_Globex_Backend_Engineer_Resume.docx"
assert Path(res["cover"]["path"]).name == "Alex_Sample_Globex_Backend_Engineer_Cover_Letter.docx"
doc = [p.text for p in Document(res["cover"]["path"]).paragraphs]
assert doc[0] == "ALEX SAMPLE" and doc[1].startswith("alex@example.com")
assert letter["greeting"] in doc and letter["paragraphs"][0] in doc and doc[-1] == "Alex Sample"
zr = c.get(res["zip"]["download_url"]); assert zr.status_code == 200 and zr.headers["content-type"] == "application/zip"
zp = Path(tempfile.mkdtemp()) / "a.zip"; zp.write_bytes(zr.content)
assert sorted(zipfile.ZipFile(zp).namelist()) == ["Alex_Sample_Globex_Backend_Engineer_Cover_Letter.docx", "Alex_Sample_Globex_Backend_Engineer_Resume.docx"]
# cover letter only
r = c.post("/api/export", json={"session_id": sid, "accepted": [], "output_dir": str(out), "include_resume": False,
                                "cover_letter": letter, "company": "Globex", "role": "Backend Engineer"})
assert r.status_code == 200 and "path" not in r.json() and "zip" not in r.json() and r.json()["cover"]["file_name"].endswith("_2.docx")
assert c.post("/api/export", json={"session_id": sid, "accepted": [], "include_resume": False}).status_code == 400
print("ok: export resume + cover + zip")

# ---- 5. errors land on the step that failed, with the real message
def boom(s, u, tool, mt):
    if tool["name"] == "record_changes":
        raise analyzer.AIError("Your Claude plan's usage limit was reached.")
    return CANNED[tool["name"]]
analyzer._call_tool = boom
evs, end = sse(c.post("/api/jobs/analyze", json={"session_id": sid, "jd_text": JD_TEXT}).json()["job_id"])
assert end["status"] == "error" and "usage limit" in end["error"], end
last = evs[-1]
assert last["step"] == "propose" and last["status"] == "error" and "usage limit" in last["message"], last
assert "running" not in final_status(evs).values()
assert c.post("/api/jobs/analyze", json={"session_id": sid, "jd_text": "short"}).status_code == 400  # rejected before a job starts
print("ok: error propagation ->", last["message"])

# ---- 6. cancel stops the job at the next checkpoint
gate = threading.Event()
def slow(s, u, tool, mt):
    gate.wait(5)
    return CANNED[tool["name"]]
analyzer._call_tool = slow
jid = c.post("/api/jobs/analyze", json={"session_id": sid, "jd_text": JD_TEXT}).json()["job_id"]
assert c.post(f"/api/jobs/{jid}/cancel").json()["ok"]
gate.set()
evs, end = sse(jid)
assert end["status"] == "cancelled", end
fs = final_status(evs)
assert fs.get("propose") == "error" and fs["analyze_jd"] == "done" and fs["resume"] == "done", fs  # lands on the next step
assert not any(e["step"] == "propose" and e["status"] == "running" for e in evs), "work continued after cancel"
assert c.get("/api/jobs/does-not-exist").status_code == 404
print("ok: cancel")

# ---- 7. a failed fetch leaves no step spinning
from ro import jd_fetch
jd_fetch.playwright_available = lambda: False
evs, end = sse(c.post("/api/jobs/jd_fetch", json={"url": "http://127.0.0.1:9/nothing"}).json()["job_id"])
assert end["status"] == "error" and "Paste the JD text" in end["error"], end
assert "running" not in final_status(evs).values(), final_status(evs)
print("ok: failed fetch ->", final_status(evs))

# ---- 8. outside a job, emit/check are harmless no-ops
jobs.emit("x", "running", "nothing listening"); jobs.check()
print("OK")
