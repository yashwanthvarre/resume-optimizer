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
                        "importance": {"type": "string", "enum": ["required", "preferred", "nice"]},
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
            "suggestions": {
                "type": "array",
                "description": "Gaps the resume can't honestly cover by rewording. Advice for the candidate; never applied automatically.",
                "items": {
                    "type": "object",
                    "properties": {"text": {"type": "string"}, "reason": {"type": "string"}},
                    "required": ["text", "reason"],
                },
            },
        },
        "required": ["overall_assessment", "changes", "suggestions"],
    },
}

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
7. Mirror the JD's exact phrasing for key terms (ATS matching is literal)."""


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
        "benefits boilerplate and EEO statements.\n\n<job_description>\n" + jd_text[:30000] +
        "\n</job_description>",
        JD_TOOL, 4000)


def propose_changes(jd: dict, paragraphs: list[dict]) -> dict:
    lines = [f'[{p["id"]}] ({p["section"]} / {p["kind"]}) {json.dumps(p["text"], ensure_ascii=False)}'
             for p in paragraphs if p["kind"] != "empty" and p["text"].strip()]
    user = (
        "Job analysis:\n" + json.dumps(jd, ensure_ascii=False, indent=1) +
        "\n\nResume paragraphs (id, section/kind, JSON-quoted text):\n" + "\n".join(lines) +
        "\n\n" + RULES +
        "\n\nPropose the edits that most improve this resume's match to the job."
    )
    return _call_tool(SYSTEM, user, CHANGES_TOOL, 12000)


_NUM = re.compile(r"\d[\d,.]*%?|\$\s?\d[\d,.]*[kKmMbB]?")


def validate_changes(raw: dict, paragraphs: list[dict]) -> dict:
    """Server-side guardrails: real targets, one change per paragraph, flag new numbers."""
    by_id = {p["id"]: p for p in paragraphs}
    all_text = "\n".join(p["text"] for p in paragraphs)
    known_nums = {n.strip("., ") for n in _NUM.findall(all_text)}
    seen, out = set(), []
    for i, c in enumerate(raw.get("changes", [])):
        pid = (c.get("target_id") or "").strip()
        p = by_id.get(pid)
        new = (c.get("new_text") or "").rstrip()
        if not p or pid in seen or not new or new.strip() == p["text"].strip():
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
        if len(new) > max(60, 1.6 * len(p["text"])):
            warnings.append("Noticeably longer than the original — check it still fits on the page.")
        out.append({
            "id": f"c{i}", "target_id": pid, "section": p["section"], "kind": p["kind"],
            "original_text": p["text"], "new_text": new, "type": c.get("type", "reword"),
            "reason": c.get("reason", ""), "jd_keywords": c.get("jd_keywords", []) or [],
            "warnings": warnings,
        })
    # order by position in the resume
    out.sort(key=lambda c: int(c["target_id"][1:]))
    return {"overall_assessment": raw.get("overall_assessment", ""), "changes": out,
            "suggestions": raw.get("suggestions", [])}
