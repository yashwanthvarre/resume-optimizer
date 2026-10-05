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
from test_e2e_data import JD, CH, COVER, JD_TEXT, keyword_decisions

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
res = c.post("/api/analyze", json={"session_id": sid, "jd_text": JD_TEXT}).json()
accepted = [{"target_id": x["target_id"], "new_text": x["new_text"]} for x in res["changes"]]
p7_edit = next(a["new_text"] for a in accepted if a["target_id"] == "p7")
K8S = "At Acme I ran our staging and production services on Kubernetes across 3 clusters with Helm charts."
PG = "Our orders database at Acme was PostgreSQL; I wrote the schema migrations and tuned slow queries."
VAGUE = "yes"
item = lambda t, n, r="": {"term": t, "mode": "note", "justification": n, "role": r}

# ---- input validation (no AI call)
n0 = len(calls)
assert c.post("/api/justify_keywords", json={"session_id": sid, "items": []}).status_code == 400
r = c.post("/api/justify_keywords", json={"session_id": sid, "items": [item("Kubernetes", K8S), item("PostgreSQL", "  ")]})
assert r.status_code == 400 and "PostgreSQL" in r.json()["detail"], r.text      # empty note
for old in ("resume", "skip", "guess"):                                           # the old modes are gone
    r = c.post("/api/justify_keywords", json={"session_id": sid, "items": [{"term": "Kubernetes", "mode": old}]})
    assert r.status_code == 400, (old, r.text)
sid2 = c.post("/api/resume/load", json={"path": str(src)}).json()["session_id"]
assert c.post("/api/justify_keywords", json={"session_id": sid2, "items": [item("Kubernetes", K8S)]}).status_code == 400
assert len(calls) == n0, "validation must not call Claude"
print("ok: input validation")

# ---- a short note is enough (no word minimum); "add" is the default mode and needs no text at all
d = c.post("/api/justify_keywords", json={"session_id": sid, "items": [item("Kubernetes", "Ran Kubernetes clusters")]})
assert d.status_code == 200 and d.json()["decisions"][0]["added"], d.text
d = c.post("/api/justify_keywords", json={"session_id": sid, "items": [{"term": "PostgreSQL"}]})
assert d.status_code == 200 and d.json()["decisions"][0]["added"], d.text
assert '<add_keyword term="PostgreSQL"' in prompts["record_keyword_decisions"]
print("ok: one keyword / short note / default add mode")

# ---- several notes in ONE request (even a one-word note is used), skills merged into one edit
n0 = len(calls)
d = c.post("/api/justify_keywords", json={"session_id": sid, "accepted": accepted, "items": [
    item("Kubernetes", K8S, "Acme Corp · Software Engineer"), item("PostgreSQL", PG), item("Docker Swarm", VAGUE)]}).json()
assert calls[n0:] == ["record_keyword_decisions"], calls[n0:]          # exactly one Claude call
dec = {x["term"]: x for x in d["decisions"]}
assert [x["term"] for x in d["decisions"]] == ["Kubernetes", "PostgreSQL", "Docker Swarm"]
assert all(x["added"] for x in d["decisions"]) and not any("follow_up_question" in x for x in d["decisions"])
by_p = {x["target_id"]: x for x in d["changes"]}
assert set(by_p) == {"p7", "p10"}, by_p.keys()
assert by_p["p10"]["jd_keywords"] == ["Kubernetes", "PostgreSQL", "Docker Swarm"]
assert by_p["p10"]["from_input"] == "Kubernetes, PostgreSQL, Docker Swarm"
assert by_p["p7"]["jd_keywords"] == ["Kubernetes"]
u = prompts["record_keyword_decisions"]
assert p7_edit in u and K8S in u and PG in u and 'role="Acme Corp · Software Engineer"' in u
assert "AT MOST ONCE" in u
print("ok: notes batch ->", {t: x["added"] for t, x in dec.items()})

# ---- mixed modes in ONE request: a note, an "Add it" Claude places, an "Add it" Claude misses (-> Skills line)
n0 = len(calls)
d = c.post("/api/justify_keywords", json={"session_id": sid, "accepted": accepted, "items": [
    item("Kubernetes", K8S), {"term": "PostgreSQL", "mode": "add"}, {"term": "Terraform", "mode": "add", "justification": "ignored"}]}).json()
assert calls[n0:] == ["record_keyword_decisions"]
u = prompts["record_keyword_decisions"]
assert '<add_keyword term="PostgreSQL"' in u and '<add_keyword term="Terraform"' in u and "ignored" not in u
assert "web search" in u and "never evidence" in u                     # research rules reach Claude
assert "not available for questions" in u and "LAST RESORT" in u and "at most 3 new items" in u
dec = {x["term"]: x for x in d["decisions"]}
assert all(x["added"] for x in d["decisions"]) and not any("follow_up_question" in x for x in d["decisions"])
assert dec["PostgreSQL"]["based_on"] == "SQL" and dec["PostgreSQL"]["evidence"] == "strong"
assert dec["Terraform"]["evidence"] == "weak" and "Skills" in dec["Terraform"]["explanation"]
by_p = {x["target_id"]: x for x in d["changes"]}
assert by_p["p10"]["source"] == "add" and by_p["p7"]["source"] == "note"
# Claude's two items stay where it put them; the fallback puts Terraform next to AWS, not at the end
assert by_p["p10"]["new_text"] == "Python, Flask, SQL, AWS, Terraform, Git, Docker, Kubernetes, PostgreSQL", by_p["p10"]["new_text"]
assert "Terraform" in by_p["p10"]["jd_keywords"]
assert any("related work for Terraform" in w for w in by_p["p10"]["warnings"]), by_p["p10"]["warnings"]
print("ok: mixed modes ->", {t: x["evidence"] for t, x in dec.items()}, {k: v["source"] for k, v in by_p.items()})

# "Add it" items are not stored as the candidate's evidence
sess = appmod.SESSIONS[sid]
assert all(j.get("mode", "note") == "note" and j["justification"] for j in sess["justifications"])

# ---- guardrails
OVERRIDE.append({"decisions": [
    {"term": "Kubernetes", "evidence": "strong", "explanation": "x"},
    {"term": "PostgreSQL", "evidence": "strong", "explanation": "x"},     # no kept change carries it -> Skills line
    {"term": "Terraform", "evidence": "strong", "explanation": "not asked"},  # ignored
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
assert dec["PostgreSQL"]["added"] and dec["PostgreSQL"]["evidence"] == "weak"
ids = {x["target_id"]: x for x in d["changes"]}
assert set(ids) == {"p6", "p10"}, ids.keys()                         # overall limit 1+2=3 ok; p8 = 3rd Kubernetes edit
assert ids["p10"]["new_text"] == "Python, Flask, SQL, PostgreSQL, AWS, Git, Docker, Kubernetes", ids["p10"]["new_text"]
assert ids["p10"]["jd_keywords"] == ["Kubernetes", "PostgreSQL"]
assert any("40" in w for w in ids["p6"]["warnings"])                  # 40 isn't in resume or notes
txt = " ".join(d["dropped"])
assert "same paragraph twice" in txt and "doesn't exist" in txt and "2-paragraph limit" in txt, d["dropped"]
print("ok: guardrails", d["dropped"])

# overall paragraph limit: 1 keyword -> at most 2 paragraphs
OVERRIDE.append({"decisions": [{"term": "Kubernetes", "evidence": "strong", "explanation": "x"}], "changes": [
    {"target_id": "p10", "new_text": "Python, Flask, SQL, AWS, Git, Docker, Kubernetes", "type": "keyword", "reason": "r"},
    {"target_id": "p6", "new_text": "Built services in Python and Flask on Kubernetes.", "type": "keyword", "reason": "r"},
    {"target_id": "p8", "new_text": "Helped teammates with Kubernetes code reviews.", "type": "keyword", "reason": "r"},
]})
d = c.post("/api/justify_keywords", json={"session_id": sid, "items": [item("Kubernetes", K8S)]}).json()
assert len(d["changes"]) == 2 and any("limit of edits" in x for x in d["dropped"]), d["dropped"]
print("ok: overall limit")

# an edit that silently drops a JD keyword the line already had is flagged
OVERRIDE.append({"decisions": [{"term": "Kubernetes", "evidence": "strong", "explanation": "x"}], "changes": [
    {"target_id": "p10", "new_text": "Python, Flask, SQL, AWS, Git, Kubernetes", "type": "keyword", "reason": "r"}]})  # Docker gone
d = c.post("/api/justify_keywords", json={"session_id": sid, "items": [item("Kubernetes", K8S)]}).json()
assert any("Drops Docker" in w for w in d["changes"][0]["warnings"]), d["changes"][0]["warnings"]
print("ok: dropped-keyword warning")

# ---- Claude returns nothing at all: every keyword still lands on the Skills line
OVERRIDE.append({"decisions": [], "changes": []})
d = c.post("/api/justify_keywords", json={"session_id": sid, "items": [{"term": "Terraform"}, {"term": "Go"}]}).json()
assert [x["added"] for x in d["decisions"]] == [True, True], d
assert [x["new_text"] for x in d["changes"]] == ["Python, Go, Flask, SQL, AWS, Terraform, Git, Docker"]
# ---- the Skills line takes at most 3 new items, most important first; never soft skills or long phrases
OVERRIDE.append({"decisions": [], "changes": []})
d = c.post("/api/justify_keywords", json={"session_id": sid, "items": [{"term": t} for t in
    ("Terraform", "Kafka", "Redis", "PostgreSQL", "Kubernetes", "attention to detail", "microservices architecture")]}).json()
dec = {x["term"]: x for x in d["decisions"]}
assert len(d["changes"]) == 1 and len(d["changes"][0]["new_text"].split(", ")) == 6 + 3, d["changes"]
# PostgreSQL is "preferred" in the JD so it goes first; then the rest in the order given
assert [t for t, x in dec.items() if x["added"]] == ["Terraform", "Kafka", "PostgreSQL"], dec
assert d["changes"][0]["new_text"] == "Python, Flask, SQL, PostgreSQL, AWS, Terraform, Git, Docker, Kafka", d["changes"]
assert not dec["attention to detail"]["added"] and not dec["microservices architecture"]["added"]
assert "naturally" in dec["microservices architecture"]["explanation"], dec["microservices architecture"]
assert not any("follow_up_question" in x for x in d["decisions"])
# Claude's own Skills edit is held to the same rules
OVERRIDE.append({"decisions": [], "changes": [{"target_id": "p10", "type": "keyword", "reason": "r",
    "new_text": "Python, Flask, SQL, PostgreSQL, AWS, Git, Docker, Kubernetes, Terraform, Kafka, attention to detail, microservices architecture"}]})
d = c.post("/api/justify_keywords", json={"session_id": sid, "items": [{"term": t} for t in
    ("PostgreSQL", "Kubernetes", "Terraform", "Kafka", "attention to detail", "microservices architecture")]}).json()
assert d["changes"][0]["new_text"] == "Python, Flask, SQL, PostgreSQL, AWS, Git, Docker, Kubernetes, Terraform", d["changes"]
assert [x["term"] for x in d["decisions"] if x["added"]] == ["PostgreSQL", "Kubernetes", "Terraform"]
# related placement inside a labelled list
assert appmod._insert_related(["Languages: Python", "SQL", "Docker"], "PostgreSQL") == ["Languages: Python", "SQL", "PostgreSQL", "Docker"]
assert appmod._insert_related(["Languages: Python", "SQL"], "Kubernetes") == ["Languages: Python", "SQL", "Kubernetes"]
assert appmod._insert_related(["Python", "Git", "Docker"], "CI/CD pipelines") == ["Python", "Git", "CI/CD pipelines", "Docker"]
print("ok: Skills-line cap, related placement, no soft skills / long phrases")

# ---- Skip: skipped keywords are never sent to Claude or added
OVERRIDE.append({"decisions": [], "changes": []})
d = c.post("/api/justify_keywords", json={"session_id": sid, "items": [{"term": "Terraform"}, {"term": "Kafka", "mode": "skip"}]}).json()
assert "term=\"Kafka\"" not in prompts["record_keyword_decisions"] and '<add_keyword term="Terraform"' in prompts["record_keyword_decisions"]
assert [x["term"] for x in d["decisions"]] == ["Terraform"] and all("Kafka" not in x["new_text"] for x in d["changes"])
n0 = len(calls)
r = c.post("/api/justify_keywords", json={"session_id": sid, "items": [{"term": "Kafka", "mode": "skip"}]})
assert r.status_code == 400 and len(calls) == n0, r.text                    # all skipped: nothing to do
print("ok: skip")

# no skills list anywhere: nothing to fall back on, so the keyword is reported as not placed (still no question)
paras = [{"id": "p1", "section": "Experience", "kind": "bullet", "text": "Built things."}]
assert appmod._skills_fallback(paras, {}, [], ["Go"], "x") == ([], [])
print("ok: Skills-line fallback")

# ---- one more note on its own
d = c.post("/api/justify_keywords", json={"session_id": sid, "items": [
    item("Docker Swarm", "I set up a Docker Swarm cluster at Acme to run our internal tools and on-call dashboards.")]}).json()
assert [x["added"] for x in d["decisions"]] == [True] and d["changes"]
assert prompts["record_keyword_decisions"].count("<candidate_note term=") == 1
print("ok: single note")

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
