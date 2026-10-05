"""AI analysis with Claude: understand the JD, then propose small, independent resume edits."""
from __future__ import annotations

import json
import re

from . import config

JD_TOOL = {
    "name": "record_jd",
    "description": "Record the structured analysis of the job description.",
    "input_schema": {
        "type": "object",
        "properties": {
            "company": {"type": "string"},
            "role": {"type": "string", "description": "Job title"},
            "seniority": {"type": "string"},
            "experience_required": {"type": "string", "description": "e.g. '3+ years Python'"},
            "summary": {"type": "string", "description": "2-3 sentence summary of what the role needs"},
            "responsibilities": {"type": "array", "items": {"type": "string"}},
            "keywords": {
                "type": "array",
                "description": "Every ATS keyword/phrase the JD itself names: languages, frameworks, libraries, "
                               "tools, platforms, databases, cloud services, methods, certifications, soft skills. "
                               "Named things, not categories: for 'frameworks such as React' the keyword is 'React'. "
                               "ONLY terms whose words appear in the JD text; "
                               "there is no minimum, so a short JD gives a short list. Never infer, summarise or "
                               "add skills 'typical for the role' that the JD doesn't write out.",
                "items": {
                    "type": "object",
                    "properties": {
                        "term": {"type": "string", "description": "A short keyword phrase (usually 1-4 words) copied verbatim from "
                                 "the JD, exactly as written there: a skill, tool or practice, not a whole requirement "
                                 "sentence. No paraphrasing, generalising or merging two phrases into one"},
                        "evidence": {"type": "string", "description": "The exact JD sentence or fragment the term was copied from"},
                        "variants": {"type": "array", "items": {"type": "string"},
                                     "description": "Only other spellings/abbreviations of the SAME term, e.g. ['k8s'] for "
                                                    "Kubernetes. Never a different or broader concept"},
                        "importance": {"type": "string", "enum": ["required", "preferred", "nice"],
                                       "description": "required = the JD explicitly states it as a must-have / minimum "
                                                      "qualification (at most ~12 keywords). Everything listed as "
                                                      "preferred, a plus or 'nice to have' is preferred/nice."},
                        "category": {"type": "string", "enum": ["hard_skill", "tool", "soft_skill", "domain", "certification", "other"]},
                    },
                    "required": ["term", "evidence", "importance", "category"],
                },
            },
            "patterns": {"type": "array", "items": {"type": "string"},
                         "description": "Themes the JD itself repeats, in the JD's own wording. Not generic recruiter phrases "
                                        "the JD doesn't use"},
        },
        "required": ["company", "role", "summary", "keywords", "patterns"],
    },
}

CHANGES_TOOL = {
    "name": "record_changes",
    "description": "Record the proposed resume edits.",
    "input_schema": {
        "type": "object",
        "properties": {
            "overall_assessment": {"type": "string", "description": "2-4 sentences: fit, main gaps, strategy"},
            "changes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "target_id": {"type": "string", "description": "Paragraph id, e.g. p12"},
                        "new_text": {"type": "string", "description": "FULL replacement text for that paragraph"},
                        "type": {"type": "string", "enum": ["reword", "keyword", "quantify", "reorder", "tighten", "summary"]},
                        "reason": {"type": "string", "description": "One sentence tied to a specific JD need"},
                        "jd_keywords": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["target_id", "new_text", "type", "reason"],
                },
            },
            "notices": {
                "type": "array",
                "description": "Instructions in the job posting about the APPLICATION itself that the candidate must "
                               "not miss (e.g. 'no AI-generated content', 'include a portfolio link', 'answer the "
                               "screening question in your cover letter'). Not resume edits, not skill gaps.",
                "items": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
            },
            "suggestions": {
                "type": "array",
                "description": "Skill or experience gaps the resume can't honestly cover by rewording — each should name "
                               "the JD keyword(s) it's about. Advice for the candidate; never applied automatically. "
                               "Application instructions go in `notices`, not here.",
                "items": {
                    "type": "object",
                    "properties": {"text": {"type": "string"}, "reason": {"type": "string"}},
                    "required": ["text", "reason"],
                },
            },
            "keyword_gaps": {
                "type": "array",
                "description": "One entry for EVERY JD keyword that the resume doesn't already contain and that none "
                               "of your changes add. Explains to the candidate why it wasn't added.",
                "items": {
                    "type": "object",
                    "properties": {
                        "term": {"type": "string", "description": "Exactly the keyword's `term` from the job analysis"},
                        "reason": {"type": "string", "description": "One short sentence addressed to the candidate"},
                    },
                    "required": ["term", "reason"],
                },
            },
        },
        "required": ["overall_assessment", "changes", "suggestions", "keyword_gaps"],
    },
}

COVER_TOOL = {
    "name": "record_cover_letter",
    "description": "Record the cover letter.",
    "input_schema": {
        "type": "object",
        "properties": {
            "greeting": {"type": "string", "description": "e.g. 'Dear Ms. Rivera,' or 'Dear Hiring Team,'"},
            "paragraphs": {"type": "array", "items": {"type": "string"}, "minItems": 3, "maxItems": 4,
                           "description": "Body paragraphs, plain text"},
            "closing": {"type": "string", "description": "e.g. 'Sincerely,'"},
            "signature": {"type": "string", "description": "Candidate's full name as written on the resume"},
            "evidence": {
                "type": "array",
                "description": "The 2-3 JD requirements the letter addresses and the resume facts that back each one",
                "items": {
                    "type": "object",
                    "properties": {"jd_requirement": {"type": "string"}, "resume_evidence": {"type": "string"}},
                    "required": ["jd_requirement", "resume_evidence"],
                },
            },
        },
        "required": ["greeting", "paragraphs", "closing", "signature", "evidence"],
    },
}

TONES = {
    "formal": "Formal and polished: complete sentences, no contractions, restrained enthusiasm.",
    "warm": "Warm and personable but professional: natural phrasing, contractions are fine, genuine interest.",
    "concise": "Concise and direct: short sentences, no preamble, every sentence carries a fact. Aim for the low end of the word range.",
}

COVER_RULES = """Rules — follow all of them:
1. 250-400 words across 3-4 body paragraphs (greeting/closing/signature not counted).
2. NEVER invent facts. Every claim about the candidate must be supported by the resume text below:
   no new employers, titles, tools, metrics, degrees or results. Use numbers only if they appear in the resume.
3. No generic filler. Do not open with "I am writing to express my interest", "I am excited to apply",
   or restate the job title as the whole first sentence. Open with a specific hook tied to the role.
4. Pick 2-3 specific JD requirements (prefer 'required' ones) and, for each, give concrete resume
   evidence. Record each pairing in `evidence`, quoting or closely paraphrasing the resume.
5. Mirror the JD's exact phrasing for key terms. Mention the company by name.
6. If a "why this company" note is given, weave it in naturally — don't paste it verbatim.
7. Greeting: use the hiring manager's name if provided, otherwise "Dear Hiring Team,".
8. Signature: the candidate's name from the first line of the resume. Plain text only — no markdown."""

KEYWORDS_TOOL = {
    "name": "record_keyword_decisions",
    "description": "Record, for each keyword, where you added it and what backs it up, and the edits that add them.",
    "input_schema": {
        "type": "object",
        "properties": {
            "decisions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "term": {"type": "string", "description": "The keyword exactly as given"},
                        "evidence": {"type": "string", "enum": ["strong", "weak"],
                                     "description": "strong: a resume line or the note clearly shows this work; "
                                                    "weak: only related work, so the candidate should double-check it"},
                        "explanation": {"type": "string", "description": "1 sentence to the candidate: where you added it"},
                        "based_on": {"type": "string", "description": "The resume line (or the candidate's note) that "
                                                                      "backs it up, quoted briefly"},
                    },
                    "required": ["term", "evidence", "explanation"],
                },
            },
            "changes": {
                "type": "array",
                "description": "The edits that add every keyword you decided to add. Each paragraph at most once.",
                "items": CHANGES_TOOL["input_schema"]["properties"]["changes"]["items"],
            },
        },
        "required": ["decisions", "changes"],
    },
}

KEYWORD_RULES = """Rules — follow all of them:
0. The candidate is not available for questions: never ask them anything. Place every keyword you can place
   naturally; a keyword that would only read as stuffing is better left out than forced in.
1. Keywords marked <add_keyword>: the candidate wants it added without being asked anything.
   a. FIRST, research these keywords with web search: what each covers in practice, i.e. the tools, tasks
      and outcomes job postings and engineers group under it. Group related keywords into one query (e.g.
      "observability Prometheus Grafana skills backend engineer"); use up to 5 searches in total. Then
      compare what you learned with the resume.
   b. Find the resume line whose work is closest to it. Count adjacent, truthful evidence: a Flask or
      Express service is REST API work; Docker images deployed to AWS are containerized deployments;
      dashboards and alerts on service metrics are observability. Name that line in based_on.
   c. PREFER BULLETS AND THE SUMMARY. Rewrite that line so the keyword sits inside the sentence as part of
      what the candidate did, never tacked on at the end: "Deployed services to AWS through CI/CD
      pipelines", not "Deployed services to AWS. CI/CD pipelines." and not "..., using CI/CD pipelines".
      Set evidence "strong" when the line clearly shows the work, "weak" when it only shows related work
      (e.g. Kubernetes when it shows Docker deployments), so the candidate double-checks it.
   d. Related keywords go into ONE natural phrase, not a list: "set up observability with Prometheus and
      Grafana dashboards", not "observability, Prometheus, Grafana".
   e. ATS software matches keywords literally, so the keyword's own words must appear (singular or plural
      is fine, a different word form is not): "scalable" does not count for "Scalability", write "designed
      for scalability"; "microservices" does not count for "Microservices architecture", write "moved the
      orders service to a microservices architecture". Natural sentence, exact words.
   f. Web results only explain what a keyword MEANS. They are never evidence of the candidate's experience:
      never take a project, tool, employer, metric or result from them.
2. Keywords with a <candidate_note>: the note is the candidate's own account, often only a few words
   ("used it for the billing dashboard at Acme"). Treat it as true and work with what it gives: turn it into
   a polished line in the right role (the role attribute, if given; otherwise the best fit). Set evidence
   "strong". Even a thin note is enough: use what it says and keep the claim modest.
3. Plan the edits for all keywords TOGETHER and spread them out. Edit each paragraph AT MOST ONCE. Add at
   most 2 keywords to any one bullet or summary sentence (a phrase like "observability with Prometheus and
   Grafana" counts as one); if more belong in the same role, use different bullets.
3b. The Skills line is a LAST RESORT, only for a concrete tool or technology (PostgreSQL, Terraform, Kafka)
   that no bullet can honestly carry. Add at most 3 new items to it in total, and insert each one next to
   the items it relates to (PostgreSQL right after SQL, Kubernetes right after Docker), never as a pile at
   the end. Never put soft skills (communication, attention to detail) or phrases of more than two words
   ("microservices architecture", "end-to-end ownership") on the Skills line: those go into a bullet or
   are left out.
4. Use at most 2 paragraphs per keyword, and at most (1 + number of keywords) paragraphs overall.
   Each change edits ONE existing paragraph (target_id), new_text is its COMPLETE new text, jd_keywords
   lists every keyword that change adds, and reason names the resume line or note it is based on.
5. Resume text below already includes the candidate's approved edits. Build on that text exactly — keep
   everything already there and only weave the keywords (and the facts from the notes) in.
6. Use only facts from the resume or the notes. Never inflate: no numbers, team sizes, scope, seniority or
   outcomes that the resume or a note doesn't state. Mirror the JD's exact spelling of each keyword. Write
   in the candidate's voice, matching the tense and style of the surrounding bullets.
7. Preserve structure: leading bullet symbols, tab characters (\\t), and "Company | Title | Dates" header
   lines. Don't edit names, contact details, dates, employers, titles, schools or headings.
8. Keep bullets concise (≤ ~1.3x their current length) and natural. No awkward rewrites like "Backend
   engineering professional" or "mentoring peers with attention to detail": if a keyword can't be said
   the way a person would say it, leave it out. Don't echo a word the line already uses ("Backend engineer
   with 4 years of backend engineering experience" -> "Engineer with 4 years of backend engineering
   experience") and don't wedge a keyword in as an aside ("built services with Flask, applying REST API
   design, that processed orders" -> "designed the REST APIs for Flask services that processed orders";
   a keyword can change form inside the sentence only if its exact words stay together)."""

SYSTEM = """You are an expert technical recruiter and resume writer who optimizes resumes for \
Applicant Tracking Systems (ATS) and human reviewers. You are scrupulously honest."""

RULES = """Rules — follow all of them:
1. NEVER invent facts. Do not add employers, titles, dates, degrees, certifications, tools, skills,
   metrics, team sizes or results that are not already supported by the resume text. You may
   re-express what is there using the JD's vocabulary (e.g. "built REST services" -> "designed
   and built RESTful APIs" is fine only if the resume shows API work).
2. A JD keyword may be added to a Skills line ONLY if the resume demonstrates it elsewhere.
   Otherwise put it in `suggestions` as "Add X — only if you have real experience with it".
3. Each change edits exactly ONE paragraph (target_id) and `new_text` is the complete new text of
   that paragraph. Use each target_id at most once. Changes must be independent: accepting or
   rejecting one must not affect another.
4. Preserve structure: keep any leading bullet symbol, tab characters (\\t), and the
   "Company | Title | Dates" style of header lines exactly. Do not edit name, contact details,
   dates, employer names, job titles, school names or headings.
5. Keep length similar (bullet ≤ ~1.2x original). Start bullets with strong action verbs. Put the
   most JD-relevant words early. Use numbers only if they already appear in that paragraph.
6. Prefer 8-20 high-impact changes over many cosmetic ones. Skip paragraphs that are already strong.
7. Mirror the JD's exact phrasing for key terms (ATS matching is literal).
8. For every JD keyword the resume doesn't contain and your changes don't add, add a `keyword_gaps`
   entry with the keyword's exact `term` and one short sentence to the candidate explaining why,
   e.g. "Your resume mentions SQL but not PostgreSQL specifically — add it only if that's the
   database you used." or "Nothing in your resume shows Kubernetes experience." """


class AIError(RuntimeError):
    pass


def _client():
    if not config.has_api_key():
        raise AIError("No Anthropic API key set. Open Settings (⚙) to add one, "
                      "or switch to 'Claude subscription (Claude Code)'.")
    import anthropic
    return anthropic.Anthropic()


# calls that may look things up on the web: the keyword step, to learn what a keyword usually covers, and the
# job finder (ro/job_search.py). Value: the Claude Code tools it gets and the API's web-search budget.
WEB_TOOLS = {"record_keyword_decisions": (("WebSearch",), 5), "record_jobs": (("WebSearch", "WebFetch"), 15)}
WEB_MAX_USES = 5
_DYNAMIC_SEARCH = re.compile(r"claude-(opus-(5|4-[678])|sonnet-(5|4-6))\b")


def _call_tool(system: str, user: str, tool: dict, max_tokens: int) -> dict:
    cc_tools, max_uses = WEB_TOOLS.get(tool["name"], ((), 0))
    if config.active_engine() == "claude_code":
        from . import claude_code
        try:
            return claude_code.run(system, user, tool["input_schema"], config.get_cc_model() or None, tools=cc_tools)
        except claude_code.ClaudeCodeError as e:
            raise AIError(str(e))
    if max_uses:
        return _call_api_with_search(system, user, tool, max_tokens, max_uses)
    return _call_api(system, user, tool, max_tokens)


def _api_errors(fn):
    import anthropic
    try:
        return fn()
    except anthropic.AuthenticationError:
        raise AIError("The Anthropic API key was rejected. Check it in Settings (⚙).")
    except anthropic.NotFoundError as e:
        raise AIError(f"Model '{config.get_model()}' not available to your key. Change it in Settings. ({e})")
    except anthropic.APIError as e:
        raise AIError(f"AI request failed: {e}")


def _call_api(system: str, user: str, tool: dict, max_tokens: int) -> dict:
    msg = _api_errors(lambda: _client().messages.create(
        model=config.get_model(), max_tokens=max_tokens, system=system,
        tools=[tool], tool_choice={"type": "tool", "name": tool["name"]},
        messages=[{"role": "user", "content": user}],
    ))
    for block in msg.content:
        if block.type == "tool_use":
            return block.input
    raise AIError("The AI returned no structured result. Please try again.")


def _call_api_with_search(system: str, user: str, tool: dict, max_tokens: int, max_uses: int = WEB_MAX_USES) -> dict:
    """Web search, then the record tool. A forced tool_choice would skip the search, so this uses "auto",
    resumes paused turns, and nudges once if Claude stops without recording its answer."""
    model = config.get_model()
    search = {"type": "web_search_20260209" if _DYNAMIC_SEARCH.search(model) else "web_search_20250305",
              "name": "web_search", "max_uses": max_uses}
    messages = [{"role": "user", "content": user + f"\n\nFinish by calling {tool['name']} exactly once."}]
    nudged = False
    for _ in range(6 + max_uses // 5):  # more searches can mean more paused turns
        msg = _api_errors(lambda: _client().messages.create(
            model=model, max_tokens=max(max_tokens, 16000), system=system,
            tools=[search, tool], tool_choice={"type": "auto"}, messages=messages,
        ))
        for block in msg.content:
            if block.type == "tool_use" and block.name == tool["name"]:
                return block.input
        messages.append({"role": "assistant", "content": msg.content})
        if msg.stop_reason == "pause_turn":
            continue  # the server resumes its search loop from the trailing server_tool_use block
        if nudged or msg.stop_reason not in ("end_turn", "tool_use"):
            break
        messages.append({"role": "user", "content": f"Now call {tool['name']} with your result."})
        nudged = True
    raise AIError("The AI returned no structured result. Please try again.")


def analyze_jd(jd_text: str) -> dict:
    jd = _call_tool(
        SYSTEM,
        "Analyze this job description. Ignore website navigation, cookie notices, "
        "benefits boilerplate and EEO statements. Keywords must be copied word for word from the JD: list only "
        "terms that literally appear in it, and none it merely implies (e.g. don't add 'cross-functional "
        "collaboration' unless the JD writes those words). Copy the keyword itself, not the sentence around it: from "
        "'Experience integrating AI tools into the software development process' the keyword is 'AI tools'. "
        "Keywords are NAMED things, spelled exactly as the JD spells them. When the JD writes '<category> such as "
        "A, B', '<category> (A or B)', '<category> like A' or '<category>, A preferred', extract A and B as separate "
        "keywords and NOT the category. Examples: 'modern JavaScript frameworks such as React and Next.js' -> "
        "'React', 'Next.js' (never 'modern JavaScript frameworks'); 'state management libraries (Redux or "
        "Zustand)' -> 'Redux', 'Zustand'; 'cloud platforms, AWS preferred' -> 'AWS'. Keep a category phrase only "
        "when the JD names nothing specific for it ('Knowledge of database systems.' -> 'database systems'). "
        "Fewer, exact keywords beat a long list. Mark a keyword "
        "'required' only when the JD states it as a must-have or minimum qualification (at most ~12); tag soft "
        "skills with category 'soft_skill'.\n\n<job_description>\n" + jd_text[:30000] +
        "\n</job_description>",
        JD_TOOL, 4000)
    return ground_keywords(jd, jd_text)


def ground_keywords(jd: dict, jd_text: str) -> dict:
    """Drop every keyword (and variant) whose words don't appear in the JD text. The model is told to copy
    terms verbatim; this makes sure of it. Dropped terms are listed in jd["dropped_keywords"]."""
    kept, dropped, seen = [], [], set()
    for k in jd.get("keywords", []) or []:
        term = (k.get("term") or "").strip() if isinstance(k, dict) else ""
        if not term:
            continue
        variants = [v for v in k.get("variants") or [] if isinstance(v, str) and v.strip()]
        found = [t for t in [term, *variants] if mentions(jd_text, t)]
        if not found:
            dropped.append(term)
            continue
        if not mentions(jd_text, term):  # only a variant is in the JD: use the JD's own wording as the term
            term, variants = found[0], [term, *variants]
        if term.lower() in seen:
            continue
        seen.add(term.lower())
        # a variant must be in the JD too, or be an abbreviation of the term (k8s, JS, Postgres) - never a new concept
        variants = [v for v in variants if v.lower() != term.lower() and (mentions(jd_text, v) or _abbrev(v, term))]
        kept.append({**k, "term": term, "variants": variants})
    kept, generic = _drop_categories(kept, jd_text)
    return {**jd, "keywords": kept, "dropped_keywords": dropped + generic}


_HEADS = {"framework", "technology", "tool", "platform", "language", "library", "solution", "system", "service",
          "database", "stack", "environment", "application", "software", "utility", "package"}
_DESCRIPTORS = {"modern", "relevant", "various", "related", "other", "popular", "common", "industry-standard",
                "contemporary", "emerging", "latest", "similar", "standard"}
# what links a category to the named items that follow it: "frameworks such as React", "libraries (Redux"
_LEAD = re.compile(r"^\s*(?:\(|:|-|\u2014|such as\b|like\b|e\.g\.?|i\.e\.?|including\b|especially\b|"
                   r"particularly\b|for example\b|for instance\b|namely\b)", re.I)
_PREFERRED = re.compile(r"^\s*,\s*(?P<item>[^,.;()]+?)\s+(?:preferred|ideally|a plus|especially|in particular)\b", re.I)
_LIST_END = re.compile(r"\.(?=\s|$)|[;)\n]|\b(?:is|are|preferred|ideally|a plus|to|for|in order)\b", re.I)


def _is_category(term: str) -> bool:
    words = re.findall(r"[a-z][a-z-]*", term.lower())
    if len(words) < 2:
        return False
    head = re.sub(r"(?:ies)$", "y", words[-1])
    head = re.sub(r"(?<!s)s$", "", head)
    return head in _HEADS or words[0] in _DESCRIPTORS


def _named_items(after: str) -> list[str]:
    """The names listed right after a category: "such as React and Next.js." -> ["React", "Next.js"]."""
    m = _PREFERRED.match(after)
    if m:
        return [m["item"].strip()]
    m = _LEAD.match(after)
    if not m:
        return []
    rest = after[m.end():]
    rest = rest[:_LIST_END.search(rest).start()] if _LIST_END.search(rest) else rest
    parts = re.split(r",|/|\band\b|\bor\b|&", rest)
    # a name: at most 3 words, starts with a capital letter or holds a digit or symbol (React, Node.js, C#, k8s)
    return [x.strip() for x in parts if x.strip() and len(x.split()) <= 3 and re.search(r"^[A-Z]|[\d.#+]", x.strip())]


def _drop_categories(kws: list[dict], jd_text: str) -> tuple[list[dict], list[str]]:
    """A category phrase ("modern frameworks", "cloud platforms") is dropped wherever the JD names the specific
    items right after it; those named items are added if the model missed them. A category the JD never
    narrows down ("Knowledge of database systems.") stays."""
    from .resume_io import kw_regex
    have = {k["term"].lower() for k in kws}
    out, dropped, added = [], [], []
    for k in kws:
        if not _is_category(k["term"]):
            out.append(k)
            continue
        items = []
        for m in kw_regex(k["term"]).finditer(jd_text):
            items += _named_items(jd_text[m.end("k"):m.end("k") + 200])
        items = [x for x in dict.fromkeys(items) if mentions(jd_text, x) and not _is_category(x)]
        if not items:
            out.append(k)
            continue
        dropped.append(f"{k['term']} (the JD names {', '.join(items)})")
        for x in items:
            if x.lower() not in have:
                have.add(x.lower())
                added.append({"term": x, "variants": [], "importance": k.get("importance", "preferred"),
                              "category": "tool", "evidence": k.get("evidence", "")})
    return out + added, dropped


def tag_changes(changes: list[dict], jd: dict) -> None:
    """Set each change's jd_keywords to the JD keywords its new text contains (ones it adds, or ones the model
    tagged). The model's own tags are never shown as-is, so a phrase that isn't a JD keyword can't appear."""
    for c in changes:
        asked = {t.lower() for t in c.get("jd_keywords") or [] if isinstance(t, str)}
        tags = []
        for k in jd.get("keywords", []):
            forms = [k["term"], *(k.get("variants") or [])]
            if not any(mentions(c["new_text"], f) for f in forms):
                continue
            if k["term"].lower() in asked or not any(mentions(c.get("original_text", ""), f) for f in forms):
                tags.append(k["term"])
        c["jd_keywords"] = tags


def _abbrev(short: str, term: str) -> bool:
    """short's letters appear in order in term, starting with its first letter: k8s/Kubernetes, JS/JavaScript."""
    a, b = re.sub(r"[^a-z]", "", short.lower()), re.sub(r"[^a-z]", "", term.lower())
    if not a or not b or a[0] != b[0] or len(a) >= len(b):
        return False
    it = iter(b)
    return all(ch in it for ch in a)


def _para_lines(paragraphs: list[dict], edits: dict[str, str] | None = None) -> list[str]:
    edits = edits or {}
    return [f'[{p["id"]}] ({p["section"]} / {p["kind"]}) {json.dumps(edits.get(p["id"], p["text"]), ensure_ascii=False)}'
            for p in paragraphs if p["kind"] != "empty" and edits.get(p["id"], p["text"]).strip()]


def propose_changes(jd: dict, paragraphs: list[dict]) -> dict:
    lines = _para_lines(paragraphs)
    user = (
        "Job analysis:\n" + json.dumps(jd, ensure_ascii=False, indent=1) +
        "\n\nResume paragraphs (id, section/kind, JSON-quoted text):\n" + "\n".join(lines) +
        "\n\n" + RULES +
        "\n\nPropose the edits that most improve this resume's match to the job."
    )
    return _call_tool(SYSTEM, user, CHANGES_TOOL, 12000)


def write_cover_letter(jd: dict, resume_text: str, hiring_manager: str = "", tone: str = "warm",
                       why_company: str = "", notes: list[str] | None = None) -> dict:
    extras = []
    if notes:
        extras.append("Additional experience the candidate described in their own words (you may use these "
                      "facts as evidence, exactly as stated):\n" + "\n".join(f"- {n}" for n in notes))
    if hiring_manager.strip():
        extras.append(f"Hiring manager: {hiring_manager.strip()}")
    if why_company.strip():
        extras.append(f"Why the candidate wants this company (their words): {why_company.strip()}")
    user = (
        "Job analysis:\n" + json.dumps(jd, ensure_ascii=False, indent=1) +
        "\n\nCandidate's resume (with their approved edits applied):\n<resume>\n" + resume_text[:20000] +
        "\n</resume>\n\n" + ("\n".join(extras) + "\n\n" if extras else "") +
        f"Tone: {TONES.get(tone, TONES['warm'])}\n\n" + COVER_RULES +
        "\n\nWrite the cover letter."
    )
    return _call_tool(SYSTEM, user, COVER_TOOL, 4000)


def decide_keywords(jd: dict, paragraphs: list[dict], edits: dict[str, str], items: list[dict]) -> dict:
    """items: [{term, mode: "add"|"note", justification, role}] — one request for all of them."""
    by_term = {k.get("term", "").lower(): k for k in jd.get("keywords", [])}
    blocks = []
    for it in items:
        kw = by_term.get(it["term"].lower(), {"term": it["term"]})
        role = f' role="{it["role"]}"' if it.get("role", "").strip() else ""
        if it.get("mode") == "note":
            blocks.append(f"Keyword: {json.dumps(kw, ensure_ascii=False)}\n"
                          f'<candidate_note term="{it["term"]}"{role}>\n{it["justification"].strip()[:2000]}\n</candidate_note>')
        else:
            blocks.append(f"Keyword: {json.dumps(kw, ensure_ascii=False)}\n"
                          f'<add_keyword term="{it["term"]}"{role} /> (no note: research it, then use what the resume shows)')
    user = (
        f"Job: {jd.get('role', '')} at {jd.get('company', '')}. {jd.get('summary', '')}\n\n"
        "Resume paragraphs (id, section/kind, JSON-quoted current text):\n" + "\n".join(_para_lines(paragraphs, edits)) +
        f"\n\nThe candidate wants these {len(items)} keywords from the job description added. For some they wrote a "
        "short note in their own words; the rest you add on your own:\n\n" + "\n\n".join(blocks) + "\n\n" + KEYWORD_RULES +
        "\n\nWrite the edits that work these keywords in naturally."
    )
    return _call_tool(SYSTEM, user, KEYWORDS_TOOL, 6000)


def mentions(text: str, term: str) -> bool:
    """Same matching idea as the UI: whole words, flexible spaces/hyphens, simple plurals."""
    from .resume_io import kw_regex
    return bool(kw_regex(term).search(text))


FILLER = ("i am writing to express", "i am excited to apply", "i am writing to apply",
          "please find attached", "to whom it may concern")


def validate_cover_letter(raw: dict, resume_text: str) -> dict:
    """Normalise the letter and flag things the candidate should double-check."""
    paras = [re.sub(r"\s+", " ", x).strip() for x in raw.get("paragraphs", []) if x and x.strip()]
    letter = {
        "greeting": (raw.get("greeting") or "Dear Hiring Team,").strip(),
        "paragraphs": paras,
        "closing": (raw.get("closing") or "Sincerely,").strip(),
        "signature": (raw.get("signature") or "").strip(),
        "evidence": [e for e in raw.get("evidence", []) or [] if e.get("jd_requirement")],
    }
    body = " ".join(paras)
    words = len(body.split())
    known = {n.strip("., ") for n in _NUM.findall(resume_text)}
    new_nums = sorted({n.strip("., ") for n in _NUM.findall(body)} - known)
    warnings = []
    if new_nums:
        warnings.append("Mentions a number not in your resume (" + ", ".join(new_nums) + ") — verify it's true.")
    if words < 200:
        warnings.append(f"Only {words} words — a bit short for a cover letter.")
    elif words > 450:
        warnings.append(f"{words} words — consider trimming to under 400.")
    low = body.lower()
    for f in FILLER:
        if f in low:
            warnings.append(f"Uses a stock phrase (\"{f}…\") — consider rewording.")
    letter.update(word_count=words, warnings=warnings)
    return letter


_NUM = re.compile(r"\d[\d,.]*%?|\$\s?\d[\d,.]*[kKmMbB]?")


def validate_changes(raw: dict, paragraphs: list[dict], known_text: str = "", id_prefix: str = "c",
                     limit: int | None = None, current: dict[str, str] | None = None) -> dict:
    """Server-side guardrails: real targets, one change per paragraph, flag new numbers.

    known_text: extra text whose numbers count as known (e.g. the candidate's own note).
    current: {paragraph_id: text already accepted}; the length check compares against it.
    """
    current = current or {}
    by_id = {p["id"]: p for p in paragraphs}
    all_text = "\n".join(p["text"] for p in paragraphs) + "\n" + known_text
    known_nums = {n.strip("., ") for n in _NUM.findall(all_text)}
    seen, out, dropped = set(), [], []
    for i, c in enumerate(raw.get("changes", [])):
        pid = (c.get("target_id") or "").strip()
        p = by_id.get(pid)
        new = (c.get("new_text") or "").rstrip()
        why = ("points at a paragraph that doesn't exist" if not p else
               "edits the same paragraph twice" if pid in seen else
               "is empty" if not new else
               "doesn't change anything" if new.strip() == p["text"].strip() else
               "is over the limit of edits" if limit is not None and len(seen) >= limit else "")
        if why:
            dropped.append(f"{pid or '(no id)'}: {why}")
            continue
        # keep leading bullet glyph/indent if the model dropped it
        lead = re.match(r"^[\s•●▪■◦‣∙·\-–*]*", p["text"]).group(0)
        if lead.strip() and not new.startswith(lead):
            new = lead + new.lstrip(" •●▪■◦‣∙·-–*")
        seen.add(pid)
        new_nums = {n.strip("., ") for n in _NUM.findall(new)} - known_nums
        warnings = []
        if new_nums:
            warnings.append("Adds a number not in your resume (" + ", ".join(sorted(new_nums)) + ") — verify it's true.")
        if len(new) > max(60, 1.6 * len(p["text"]), 1.3 * len(current.get(pid, ""))):
            warnings.append("Noticeably longer than the original — check it still fits on the page.")
        out.append({
            "id": f"{id_prefix}{i}", "target_id": pid, "section": p["section"], "kind": p["kind"],
            "original_text": p["text"], "new_text": new, "type": c.get("type", "reword"),
            "reason": c.get("reason", ""), "jd_keywords": c.get("jd_keywords", []) or [],
            "warnings": warnings,
        })
    # order by reading position in the resume (ids follow the file, which isn't always reading order)
    pos = {p["id"]: n for n, p in enumerate(paragraphs)}
    out.sort(key=lambda c: pos.get(c["target_id"], 0))
    return {"overall_assessment": raw.get("overall_assessment", ""), "changes": out,
            "suggestions": raw.get("suggestions", []), "dropped": dropped,
            "notices": [n["text"].strip() for n in raw.get("notices", []) or [] if isinstance(n, dict) and (n.get("text") or "").strip()],
            "keyword_gaps": [g for g in raw.get("keyword_gaps", []) or []
                             if isinstance(g, dict) and g.get("term") and g.get("reason")]}
