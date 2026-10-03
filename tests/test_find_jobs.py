"""Job finder: only fresh, real, distinct postings survive; the job runs, cancels, and gives each tab its own session.
AI calls are mocked."""
import os, sys, json, tempfile, threading, time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["ANTHROPIC_API_KEY"] = "test"
os.environ["HOME"] = os.environ["USERPROFILE"] = tempfile.mkdtemp()
from fastapi.testclient import TestClient
import app as appmod
from ro import analyzer, claude_code, config, job_search

NOW = datetime(2026, 10, 2, 15, 0, tzinfo=timezone.utc)
iso = lambda minutes: (NOW - timedelta(minutes=minutes)).isoformat()


def job(title="Backend Engineer", company="Globex", url="https://boards.greenhouse.io/globex/jobs/1", age=30, **kw):
    return {"title": title, "company": company, "url": url, "posted_at": f"{age} minutes ago",
            "posted_age_minutes": age, "match_reason": "Python on AWS.", **kw}


# ---- 1. validation
raw = {"profile": "Backend, Python", "jobs": [
    job(),
    job(title="Old", url="https://x.test/old", age=180),                                         # too old
    job(title="Unknown", url="https://x.test/u", posted_age_minutes=None, posted_at="recently"),  # no time
    job(title="Dup url", url="https://www.boards.greenhouse.io/globex/jobs/1/"),                   # same posting
    job(title="backend engineer", company="GLOBEX", url="https://x.test/again"),                 # same company+title
    job(title="Search", url="https://www.linkedin.com/jobs/search?keywords=python"),             # listing page
    job(title="No link", url="globex.com/careers"),
    job(title="", url="https://x.test/notitle"),
    job(title="ISO fresh", url="https://x.test/iso", posted_at=iso(110), posted_age_minutes=999),  # ISO wins
    job(title="ISO old", url="https://x.test/iso-old", posted_at=iso(125), posted_age_minutes=5),
    job(title="Future", url="https://x.test/future", posted_at=iso(-60)),
    job(title="Bool age", url="https://x.test/bool", posted_age_minutes=True, posted_at="x"),
]}
out = job_search.validate_jobs(raw, NOW)
assert [j["title"] for j in out["jobs"]] == ["Backend Engineer", "ISO fresh"], out
assert out["jobs"][1]["age_minutes"] == 110 and out["jobs"][0]["source"] == "boards.greenhouse.io"
reasons = " | ".join(out["dropped"])
for why in ("posted 180 minutes ago", "posting time unknown", "duplicate", "search page", "no valid link",
            "no title or company", "posted 125 minutes ago", "in the future"):
    assert why in reasons, (why, reasons)
assert len(out["dropped"]) == 10, out["dropped"]
print("ok: old, undated, duplicate, listing and invalid postings dropped")

many = {"jobs": [job(title=f"Engineer {i}", url=f"https://x.test/{i}") for i in range(8)]}
assert len(job_search.validate_jobs(many, NOW)["jobs"]) == 5
assert job_search.validate_jobs({"jobs": []}, NOW)["jobs"] == []
print("ok: capped at 5; none is fine")

# ---- 2. the request: current time and resume go in; Claude Code gets WebSearch + WebFetch
seen = {}
def fake_run(s, u, schema, model=None, tools=()):
    seen.update(user=u, tools=tools, schema=schema); return {"profile": "p", "jobs": [job()]}
with mock.patch.object(config, "active_engine", lambda: "claude_code"), mock.patch.object(claude_code, "run", fake_run):
    got = job_search.find_jobs("Alex Sample\nBackend engineer, Python", started=NOW)
assert seen["tools"] == ("WebSearch", "WebFetch") and "2026-10-02T15:00Z" in seen["user"]
assert "Backend engineer, Python" in seen["user"] and "120 minutes" in seen["user"]
assert seen["schema"] == job_search.JOBS_TOOL["input_schema"] and len(got["jobs"]) == 1
print("ok: Claude Code searches and fetches pages")

# API engine: web search with the larger budget
from types import SimpleNamespace as NS
reqs = []
rec = NS(type="tool_use", name="record_jobs", input={"profile": "p", "jobs": []})
fake = NS(messages=NS(create=lambda **kw: reqs.append(kw) or NS(stop_reason="tool_use", content=[rec])))
with mock.patch.object(config, "active_engine", lambda: "api"), mock.patch.object(analyzer, "_client", lambda: fake):
    job_search.find_jobs("resume", started=NOW)
assert reqs[0]["tools"][0]["name"] == "web_search" and reqs[0]["tools"][0]["max_uses"] == 15
print("ok: API gets web search, 15 uses")

# ---- 3. the background job, cancel, and per-tab sessions
c = TestClient(appmod.app)
src = (Path(__file__).parent / "sample_resume.docx").resolve()
sid = c.post("/api/resume/load", json={"path": str(src)}).json()["session_id"]


def run_job(path, body):
    info = c.post(path, json=body).json()
    with c.stream("GET", f"/api/jobs/{info['job_id']}/events") as r:
        evs, end = [], None
        for line in r.iter_lines():
            if line.startswith("data: "):
                d = json.loads(line[6:])
                if "seq" in d: evs.append(d)
                else: end = d
    return info, evs, end


fresh = {"profile": "Backend", "jobs": [job(), job(title="Old", url="https://x.test/o", age=600)]}
with mock.patch.object(analyzer, "_call_tool", lambda s, u, t, mt: fresh):
    info, evs, end = run_job("/api/jobs/find_jobs", {"session_id": sid})
assert [p["step"] for p in info["plan"]] == ["profile", "search", "check"]
assert end["status"] == "done" and [j["company"] for j in end["result"]["jobs"]] == ["Globex"], end
assert any("1 posting from the last 2 hours, 1 left out" in e["message"] for e in evs), evs
assert c.post("/api/jobs/find_jobs", json={"session_id": "nope"}).status_code == 404
print("ok: find_jobs job")


def slow(s, u, t, mt):
    from ro import jobs
    for _ in range(100):
        jobs.check(); time.sleep(0.05)
    return fresh
with mock.patch.object(analyzer, "_call_tool", slow):
    jid = c.post("/api/jobs/find_jobs", json={"session_id": sid}).json()["job_id"]
    time.sleep(0.3); c.post(f"/api/jobs/{jid}/cancel")
    for _ in range(50):
        if c.get(f"/api/jobs/{jid}").json()["status"] != "running": break
        time.sleep(0.1)
assert c.get(f"/api/jobs/{jid}").json()["status"] == "cancelled"
print("ok: cancel")

a = c.post("/api/resume/clone", json={"session_id": sid}).json()
b = c.post("/api/resume/clone", json={"session_id": sid}).json()
assert len({sid, a["session_id"], b["session_id"]}) == 3 and a["file_name"] == "sample_resume.docx"
assert a["paragraphs"] == b["paragraphs"]
appmod.SESSIONS[a["session_id"]]["jd"] = {"company": "Globex", "role": "Backend Engineer"}
appmod.SESSIONS[b["session_id"]]["jd"] = {"company": "Initech", "role": "Backend Engineer"}
na = c.post("/api/file_names", json={"session_id": a["session_id"]}).json()
nb = c.post("/api/file_names", json={"session_id": b["session_id"]}).json()
assert na["resume"] != nb["resume"] and na["cover"] != nb["cover"] and "Initech" in nb["cover"], (na, nb)
assert "jd" not in appmod.SESSIONS[sid]
assert c.post("/api/resume/clone", json={"session_id": "nope"}).status_code == 404
print("ok: each tab gets its own session and distinct file names")
print("OK")
