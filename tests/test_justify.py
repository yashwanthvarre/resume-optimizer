"""Fill the gaps: justify several 'Not added' keywords in ONE request (AI mocked)."""
import os, sys, json, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["ANTHROPIC_API_KEY"] = "test"
_home = tempfile.mkdtemp(); os.environ["HOME"] = os.environ["USERPROFILE"] = _home
from fastapi.testclient import TestClient
import app as appmod
from ro import analyzer
sys.path.insert(0, str(Path(__file__).parent))
from test_e2e_data import JD, CH, COVER, keyword_decisions

prompts, calls, OVERRIDE = {}, [], []
def fake(s, u, tool, mt):
    prompts[tool["name"]] = u; calls.append(tool["name"])
    if tool["name"] == "record_keyword_decisions":
        return OVERRIDE.pop() if OVERRIDE else keyword_decisions(u)
    return {"record_jd": JD, "record_changes": CH, "record_cover_letter": COVER}[tool["name"]]
analyzer._call_tool = fake

c = TestClient(appmod.app)
src = (Path(__file__).parent / "sample_resume.docx").resolve()
sid = c.post("/api/resume/load", json={"path": str(src)}).json()["session_id"]
res = c.post("/api/analyze", json={"session_id": sid, "jd_text": "x" * 200}).json()
accepted = [{"target_id": x["target_id"], "new_text": x["new_text"]} for x in res["changes"]]
p7_edit = next(a["new_text"] for a in accepted if a["target_id"] == "p7")
K8S = "At Acme I ran our staging and production services on Kubernetes across 3 clusters with Helm charts."
PG = "Our orders database at Acme was PostgreSQL; I wrote the schema migrations and tuned slow queries."
VAGUE = "I know Docker Swarm pretty well."
item = lambda t, n, r="": {"term": t, "justification": n, "role": r}

# ---- input validation (no AI call)
n0 = len(calls)
assert c.post("/api/justify_keywords", json={"session_id": sid, "items": []}).status_code == 400
r = c.post("/api/justify_keywords", json={"session_id": sid, "items": [item("Kubernetes", K8S), item("PostgreSQL", "yes")]})
assert r.status_code == 400 and "PostgreSQL" in r.json()["detail"], r.text      # under 3 words
r = c.post("/api/justify_keywords", json={"session_id": sid, "items": [{"term": "Kubernetes", "mode": "guess"}]})
assert r.status_code == 400, r.text
sid2 = c.post("/api/resume/load", json={"path": str(src)}).json()["session_id"]
assert c.post("/api/justify_keywords", json={"session_id": sid2, "items": [item("Kubernetes", K8S)]}).status_code == 400
assert len(calls) == n0, "validation must not call Claude"
print("ok: input validation")

# ---- a single keyword with a short (3-word) note is enough; resume mode needs no text at all
d = c.post("/api/justify_keywords", json={"session_id": sid, "items": [item("Kubernetes", "Ran Kubernetes clusters")]})
assert d.status_code == 200 and d.json()["decisions"][0]["decision"] == "decline", d.text  # short note -> Claude asks for more
d = c.post("/api/justify_keywords", json={"session_id": sid, "items": [{"term": "PostgreSQL", "mode": "resume"}]})
assert d.status_code == 200, d.text
print("ok: one keyword / short note / no-text resume mode accepted")

# ---- mixed add / decline in ONE request, skills merged into one edit
n0 = len(calls)
d = c.post("/api/justify_keywords", json={"session_id": sid, "accepted": accepted, "items": [
    item("Kubernetes", K8S, "Acme Corp · Software Engineer"), item("PostgreSQL", PG), item("Docker Swarm", VAGUE)]}).json()
assert calls[n0:] == ["record_keyword_decisions"], calls[n0:]          # exactly one Claude call
dec = {x["term"]: x for x in d["decisions"]}
assert [x["term"] for x in d["decisions"]] == ["Kubernetes", "PostgreSQL", "Docker Swarm"]
assert dec["Kubernetes"]["decision"] == dec["PostgreSQL"]["decision"] == "add"
assert dec["Docker Swarm"]["decision"] == "decline" and dec["Docker Swarm"]["follow_up_question"].endswith("?")
by_p = {x["target_id"]: x for x in d["changes"]}
assert set(by_p) == {"p7", "p10"}, by_p.keys()
assert by_p["p10"]["jd_keywords"] == ["Kubernetes", "PostgreSQL"] and by_p["p10"]["from_input"] == "Kubernetes, PostgreSQL"
assert by_p["p7"]["jd_keywords"] == ["Kubernetes"]
u = prompts["record_keyword_decisions"]
assert p7_edit in u and K8S in u and PG in u and 'role="Acme Corp · Software Engineer"' in u
assert "AT MOST ONCE" in u
print("ok: mixed batch ->", {t: x["decision"] for t, x in dec.items()})

# ---- mixed modes in ONE request: a note-based add, a resume-drafted add, a resume-mode decline
n0 = len(calls)
d = c.post("/api/justify_keywords", json={"session_id": sid, "accepted": accepted, "items": [
    item("Kubernetes", K8S), {"term": "PostgreSQL", "mode": "resume"}, {"term": "Terraform", "mode": "resume", "justification": "ignored"}]}).json()
assert calls[n0:] == ["record_keyword_decisions"]
u = prompts["record_keyword_decisions"]
assert '<draft_from_resume term="PostgreSQL"' in u and '<draft_from_resume term="Terraform"' in u and "ignored" not in u
dec = {x["term"]: x for x in d["decisions"]}
assert dec["Kubernetes"]["decision"] == "add" and dec["PostgreSQL"]["decision"] == "add"
assert dec["Terraform"]["decision"] == "decline" and dec["Terraform"]["follow_up_question"] == "Where have you used Terraform?"
by_p = {x["target_id"]: x for x in d["changes"]}
assert by_p["p10"]["source"] == "resume" and any("confirm it's accurate" in w and "PostgreSQL" in w for w in by_p["p10"]["warnings"])
assert by_p["p7"]["source"] == "note" and not any("confirm" in w for w in by_p["p7"]["warnings"])
print("ok: mixed modes ->", {t: x["decision"] for t, x in dec.items()}, {k: v["source"] for k, v in by_p.items()})

# resume-mode items are not stored as the candidate's evidence
sess = appmod.SESSIONS[sid]
assert all(j.get("mode", "note") == "note" and j["justification"] for j in sess["justifications"])

# ---- guardrails
OVERRIDE.append({"decisions": [
    {"term": "Kubernetes", "decision": "add", "explanation": "x"},
    {"term": "PostgreSQL", "decision": "add", "explanation": "x"},       # no change will carry it -> downgraded
    {"term": "Terraform", "decision": "add", "explanation": "not asked"},  # ignored
], "changes": [
    {"target_id": "p10", "new_text": "Python, Flask, SQL, AWS, Git, Docker, Kubernetes", "type": "keyword", "reason": "r"},
    {"target_id": "p10", "new_text": "Python, Flask, SQL, AWS, Git, Docker, Kubernetes, PostgreSQL", "type": "keyword", "reason": "r"},  # same paragraph twice
    {"target_id": "p6", "new_text": "Built services in Python and Flask on Kubernetes for 40 regions.", "type": "keyword", "reason": "r"},
    {"target_id": "p8", "new_text": "Helped teammates with code reviews of Kubernetes manifests.", "type": "keyword", "reason": "r"},  # 3rd for Kubernetes
    {"target_id": "p99", "new_text": "nope", "type": "keyword", "reason": "r"},
]})
d = c.post("/api/justify_keywords", json={"session_id": sid, "items": [item("Kubernetes", K8S), item("PostgreSQL", PG)]}).json()
dec = {x["term"]: x for x in d["decisions"]}
assert set(dec) == {"Kubernetes", "PostgreSQL"}, dec.keys()           # Terraform ignored
assert dec["PostgreSQL"]["decision"] == "decline" and dec["PostgreSQL"]["follow_up_question"]
ids = {x["target_id"]: x for x in d["changes"]}
assert set(ids) == {"p6", "p10"}, ids.keys()                         # overall limit 1+2=3 ok; p8 = 3rd Kubernetes edit
assert "Kubernetes" in ids["p10"]["new_text"] and "PostgreSQL" not in ids["p10"]["new_text"]
assert any("40" in w for w in ids["p6"]["warnings"])                  # 40 isn't in resume or notes
txt = " ".join(d["dropped"])
assert "same paragraph twice" in txt and "doesn't exist" in txt and "2-paragraph limit" in txt, d["dropped"]
print("ok: guardrails", d["dropped"])

# overall paragraph limit: 1 keyword -> at most 2 paragraphs
OVERRIDE.append({"decisions": [{"term": "Kubernetes", "decision": "add", "explanation": "x"}], "changes": [
    {"target_id": "p10", "new_text": "Python, Flask, SQL, AWS, Git, Docker, Kubernetes", "type": "keyword", "reason": "r"},
    {"target_id": "p6", "new_text": "Built services in Python and Flask on Kubernetes.", "type": "keyword", "reason": "r"},
    {"target_id": "p8", "new_text": "Helped teammates with Kubernetes code reviews.", "type": "keyword", "reason": "r"},
]})
d = c.post("/api/justify_keywords", json={"session_id": sid, "items": [item("Kubernetes", K8S)]}).json()
assert len(d["changes"]) == 2 and any("limit of edits" in x for x in d["dropped"]), d["dropped"]
print("ok: overall limit")

# an edit that silently drops a JD keyword the line already had is flagged
OVERRIDE.append({"decisions": [{"term": "Kubernetes", "decision": "add", "explanation": "x"}], "changes": [
    {"target_id": "p10", "new_text": "Python, Flask, SQL, AWS, Git, Kubernetes", "type": "keyword", "reason": "r"}]})  # Docker gone
d = c.post("/api/justify_keywords", json={"session_id": sid, "items": [item("Kubernetes", K8S)]}).json()
assert any("Drops Docker" in w for w in d["changes"][0]["warnings"]), d["changes"][0]["warnings"]
print("ok: dropped-keyword warning")

# ---- resubmitting only the declined one
d = c.post("/api/justify_keywords", json={"session_id": sid, "items": [
    item("Docker Swarm", "I set up a Docker Swarm cluster at Acme to run our internal tools and on-call dashboards.")]}).json()
assert [x["decision"] for x in d["decisions"]] == ["add"] and d["changes"]
assert prompts["record_keyword_decisions"].count("<candidate_note term=") == 1
print("ok: resubmit only declined")

# ---- notes reach the cover letter
c.post("/api/cover_letter", json={"session_id": sid, "accepted": accepted})
assert K8S in prompts["record_cover_letter"] and PG in prompts["record_cover_letter"]
print("ok: notes reach cover letter")

# ---- as a job
job = c.post("/api/jobs/justify_keywords", json={"session_id": sid, "accepted": accepted,
                                                 "items": [item("Kubernetes", K8S), item("Docker Swarm", VAGUE)]}).json()
assert [p["step"] for p in job["plan"]] == ["note", "decide", "check"] and "(2)" in job["plan"][0]["label"]
evs, end, kind = [], None, "message"
with c.stream("GET", f"/api/jobs/{job['job_id']}/events") as r:
    for line in r.iter_lines():
        if line.startswith("event:"): kind = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            if kind == "end": end = json.loads(line[5:])
            else: evs.append(json.loads(line[5:]))
            kind = "message"
assert list(dict.fromkeys(e["step"] for e in evs)) == ["note", "decide", "check"]
assert {e["step"]: e["status"] for e in evs} == {"note": "done", "decide": "done", "check": "done"}
assert end["status"] == "done" and len(end["result"]["decisions"]) == 2
assert c.post("/api/justify_keyword", json={}).status_code in (404, 405)  # old single-keyword endpoint is gone
print("ok: job events")
print("OK")
