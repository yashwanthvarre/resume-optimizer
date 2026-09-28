"""Offline tests for JD extraction (network mocked)."""
import json, sys
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ro import jd_fetch

DESC = "<p>We are hiring a Backend Engineer.</p><ul><li>5+ years Python</li><li>Build REST APIs on AWS</li></ul>" + "<p>More detail about the team and mission.</p>" * 10

class R:
    def __init__(self, text="", js=None, status=200, url=""):
        self.text, self._js, self.status_code, self.ok, self.url = text, js, status, status < 400, url
    def json(self): return self._js

def run(url, responses):
    calls = []
    def fake_get(u, **kw):
        calls.append(u)
        for key, resp in responses.items():
            if key in u: return resp
        return R(status=404)
    with mock.patch.object(jd_fetch.requests, "get", fake_get), mock.patch.object(jd_fetch, "playwright_available", lambda: False):
        try: return jd_fetch.fetch_jd(url), calls
        except jd_fetch.FetchError as e: return str(e), calls

# 1. JSON-LD on a normal page
ld = {"@context": "https://schema.org", "@type": "JobPosting", "title": "Backend Engineer", "description": DESC,
      "hiringOrganization": {"@type": "Organization", "name": "Globex"}}
html = f'<html><head><script type="application/ld+json">{json.dumps(ld)}</script></head><body>nav</body></html>'
res, _ = run("https://careers.globex.com/jobs/123", {"globex.com": R(html, url="https://careers.globex.com/jobs/123")})
assert res["company"] == "Globex" and "• 5+ years Python" in res["text"], res; print("jsonld OK:", res["method"])

# 2. Workday API
wd = {"jobPostingInfo": {"title": "Senior Engineer", "jobDescription": DESC}, "hiringOrganization": {"name": "NVIDIA"}}
res, calls = run("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-Engineer_JR1", {"/wday/cxs/": R(js=wd)})
assert res["method"] == "Workday API" and calls[0] == "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-Engineer_JR1", calls
print("workday OK:", res["title"], res["company"])

# 3. Greenhouse API
res, calls = run("https://job-boards.greenhouse.io/acme/jobs/4020300008", {"boards-api": R(js={"title": "ML Eng", "content": "&lt;p&gt;Hello&lt;/p&gt;" + DESC, "company_name": "Acme"})})
assert res["method"] == "Greenhouse API" and "Hello" in res["text"]; print("greenhouse OK")

# 4. LinkedIn guest page
li = f'<h2 class="top-card-layout__title">Data Engineer</h2><a class="topcard__org-name-link">Initech</a><div class="show-more-less-html__markup">{DESC}</div>'
res, calls = run("https://www.linkedin.com/jobs/search/?currentJobId=3999999999&keywords=x", {"jobs-guest": R(li)})
assert res["company"] == "Initech" and "3999999999" in calls[0]; print("linkedin OK")

# 5. main-content fallback
page = "<html><body><nav>Home</nav><article><h1>Platform Engineer</h1>" + DESC * 2 + "</article></body></html>"
res, _ = run("https://example.org/job", {"example.org": R(page, url="https://example.org/job")})
assert res["method"] == "Direct fetch" and "Python" in res["text"]; print("trafilatura OK")

# 6. total failure -> helpful message
res, _ = run("https://example.org/job", {"example.org": R("<html>Sign in</html>", url="https://example.org/job")})
assert isinstance(res, str) and "Paste" in res; print("failure message OK:", res[:120])
