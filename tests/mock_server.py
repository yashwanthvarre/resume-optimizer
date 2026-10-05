"""Run the app with canned AI responses — for UI development without an API key.
Usage: python tests/mock_server.py [port]      (MOCK_DELAY=seconds per AI call, default 1.5)"""
import os, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("ANTHROPIC_API_KEY", "mock")
import uvicorn, app as appmod
from ro import analyzer, jd_fetch
sys.path.insert(0, str(Path(__file__).parent))
from test_e2e_data import JD, CH, COVER, keyword_decisions
CANNED = {"record_jd": JD, "record_changes": CH, "record_cover_letter": COVER}
CANNED["record_jobs"] = {"profile": "Backend engineer, Python/AWS, remote", "jobs": [
    {"title": "Backend Engineer", "company": "Globex", "location": "Remote", "url": "https://jobs.example.test/globex",
     "posted_at": "35 minutes ago", "posted_age_minutes": 35, "match_reason": "Python services on AWS.", "source": "Greenhouse"},
    {"title": "Platform Engineer", "company": "Initech", "location": "Austin, TX", "url": "https://jobs.example.test/initech",
     "posted_at": "1 hour ago", "posted_age_minutes": 60, "match_reason": "REST APIs and Docker.", "source": "Lever"},
    {"title": "Senior Engineer", "company": "Hooli", "url": "https://jobs.example.test/hooli",
     "posted_at": "1 day ago", "posted_age_minutes": 1440, "match_reason": "Too old; must be dropped."}]}
def fake(s, u, tool, mt):
    time.sleep(float(os.environ.get("MOCK_DELAY", "1.5")))  # lets the progress UI be seen
    if tool["name"] == "record_keyword_decisions":
        return keyword_decisions(u)
    return CANNED[tool["name"]]
analyzer._call_tool = fake
analyzer.ground_keywords = lambda jd, text: jd  # UI tests paste arbitrary JD text; keep the canned keywords
from ro.jobs import emit
_real_fetch = jd_fetch.fetch_jd
FETCHES = []  # canned fetches started, readable at /api/_mock/fetches
def fake_fetch(url):  # links on a .test host return a canned posting (for UI tests); others fetch for real
    if ".test/" not in url + "/":
        return _real_fetch(url)
    FETCHES.append(url)
    emit("fetch", "running", "Fetching the canned posting")
    time.sleep(float(os.environ.get("MOCK_DELAY", "1.5")))
    if "fail" in url:
        raise jd_fetch.FetchError("Couldn't read that page. Paste the job description instead.")
    return {"text": "Backend Engineer at Globex. Python, REST APIs, AWS, microservices. " * 5,
            "title": "Backend Engineer", "company": "Globex", "method": "mock"}
jd_fetch.fetch_jd = fake_fetch
appmod.app.get("/api/_mock/fetches")(lambda: FETCHES)
appmod.app.router.routes.insert(0, appmod.app.router.routes.pop())  # before the static-files mount
uvicorn.run(appmod.app, host="127.0.0.1", port=int(sys.argv[1]) if len(sys.argv) > 1 else 8799, log_level="warning")
