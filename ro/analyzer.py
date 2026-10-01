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
                "description": "15-35 ATS keywords/phrases a recruiter or ATS would scan for. "
                               "Hard skills, tools, methods, domain terms, certifications.",
                "items": {
                    "type": "object",
                    "properties": {
                        "term": {"type": "string", "description": "Canonical form as written in the JD"},
                        "variants": {"type": "array", "items": {"type": "string"},
                                     "description": "Other spellings/abbreviations, e.g. ['k8s'] for Kubernetes"},
                        "importance": {"type": "string", "enum": ["required", "preferred", "nice"],
                                       "description": "required = the JD explicitly states it as a must-have / minimum "
                                                      "qualification (at most ~12 keywords). Everything listed as "
                                                      "preferred, a plus or 'nice to have' is preferred/nice."},
                        "category": {"type": "string", "enum": ["hard_skill", "tool", "soft_skill", "domain", "certification", "other"]},
                    },
                    "required": ["term", "importance", "category"],
                },
            },
            "patterns": {"type": "array", "items": {"type": "string"},
                         "description": "Themes the JD repeats (e.g. 'ownership of end-to-end delivery', 'stakeholder communication')"},
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
    "description": "Record, for each keyword, whether the candidate's note supports adding it, and the edits that add them.",
    "input_schema": {
        "type": "object",
        "properties": {
            "decisions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "term": {"type": "string", "description": "The keyword exactly as given"},
                        "decision": {"type": "string", "enum": ["add", "decline"]},
                        "explanation": {"type": "string", "description": "1 sentence to the candidate: where you added it, "
                                                                         "or why the note isn't enough yet"},
                        "follow_up_question": {"type": "string", "description": "When declining: ONE specific question "
                                                                                "whose answer would let you add it"},
                    },
                    "required": ["term", "decision", "explanation"],
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
1. Keywords with a <candidate_note>: decide each on its OWN note. Decide "add" ONLY if that note genuinely
   shows hands-on experience with the keyword. A bare claim ("I know it", "used it a bit") or something
   unrelated is NOT enough: decide "decline" and ask ONE specific follow-up question (what they built with
   it, where, their role).
1b. Keywords marked <draft_from_resume>: the candidate asked you to write it in from their resume alone.
   Decide "add" ONLY if the resume already shows work that the keyword truthfully describes (e.g. "built UI
   components in JSX" -> React; a Python REST service -> REST APIs), and name that resume line in the
   explanation. NEVER invent a project, employer, tool usage or result to fit the keyword. If nothing in the
   resume supports it, decide "decline", explain that, and set follow_up_question to invite a note
   (e.g. "Where have you used React?").
2. Plan the edits for all added keywords TOGETHER. Edit each paragraph AT MOST ONCE: if several keywords
   belong in the same paragraph (e.g. the Skills line), put them all in that one edit. Keep bullets readable —
   don't stuff several keywords into one bullet when separate bullets fit better.
3. Use at most 2 paragraphs per added keyword, and at most (1 + number of added keywords) paragraphs overall.
   Each change edits ONE existing paragraph (target_id), new_text is its COMPLETE new text, and jd_keywords
   lists every keyword that change adds.
4. Resume text below already includes the candidate's approved edits. Build on that text exactly — keep
   everything already there and only weave the keywords (and the facts from the notes) in.
5. Use only facts from the resume or the notes. Never inflate: no numbers, team sizes, scope, seniority or
   outcomes that a note doesn't state. Mirror the JD's exact spelling of each keyword.
6. Preserve structure: leading bullet symbols, tab characters (\\t), and "Company | Title | Dates" header
   lines. Don't edit names, contact details, dates, employers, titles, schools or headings.
7. Keep bullets concise (≤ ~1.3x their current length)."""

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


def _call_tool(system: str, user: str, tool: dict, max_tokens: int) -> dict:
    if config.active_engine() == "claude_code":
        from . import claude_code
        try:
            return claude_code.run(system, user, tool["input_schema"], config.get_cc_model() or None)
        except claude_code.ClaudeCodeError as e:
            raise AIError(str(e))
    return _call_api(system, user, tool, max_tokens)


def _call_api(system: str, user: str, tool: dict, max_tokens: int) -> dict:
    import anthropic
    try:
        msg = _client().messages.create(
            model=config.get_model(), max_tokens=max_tokens, system=system,
            tools=[tool], tool_choice={"type": "tool", "name": tool["name"]},
            messages=[{"role": "user", "content": user}],
        )
    except anthropic.AuthenticationError:
        raise AIError("The Anthropic API key was rejected. Check it in Settings (⚙).")
    except anthropic.NotFoundError as e:
        raise AIError(f"Model '{config.get_model()}' not available to your key. Change it in Settings. ({e})")
    except anthropic.APIError as e:
        raise AIError(f"AI request failed: {e}")
    for block in msg.content:
        if block.type == "tool_use":
            return block.input
    raise AIError("The AI returned no structured result. Please try again.")


def analyze_jd(jd_text: str) -> dict:
    return _call_tool(
        SYSTEM,
        "Analyze this job description. Ignore website navigation, cookie notices, "
        "benefits boilerplate and EEO statements. Mark a keyword 'required' only when the JD states it as a "
        "must-have or minimum qualification (at most ~12); tag soft skills with category 'soft_skill'.\n\n<job_description>\n" + jd_text[:30000] +
        "\n</job_description>",
        JD_TOOL, 4000)


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
    """items: [{term, mode: "note"|"resume", justification, role}] — one request for all of them."""
    by_term = {k.get("term", "").lower(): k for k in jd.get("keywords", [])}
    blocks = []
    for it in items:
        kw = by_term.get(it["term"].lower(), {"term": it["term"]})
        role = f' role="{it["role"]}"' if it.get("role", "").strip() else ""
        if it.get("mode") == "resume":
            blocks.append(f"Keyword: {json.dumps(kw, ensure_ascii=False)}\n"
                          f'<draft_from_resume term="{it["term"]}"{role} /> (no note: use only what the resume shows)')
        else:
            blocks.append(f"Keyword: {json.dumps(kw, ensure_ascii=False)}\n"
                          f'<candidate_note term="{it["term"]}"{role}>\n{it["justification"].strip()[:2000]}\n</candidate_note>')
    user = (
        f"Job: {jd.get('role', '')} at {jd.get('company', '')}. {jd.get('summary', '')}\n\n"
        "Resume paragraphs (id, section/kind, JSON-quoted current text):\n" + "\n".join(_para_lines(paragraphs, edits)) +
        f"\n\nThe candidate wants these {len(items)} keywords from the job description added. For some they wrote a "
        "note in their own words; for others they asked you to write it in from their resume:\n\n" + "\n\n".join(blocks) + "\n\n" + KEYWORD_RULES +
        "\n\nDecide each keyword, then write the edits for the ones you add."
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
