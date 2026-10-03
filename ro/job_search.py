"""Find fresh job postings that fit the resume: Claude searches the web, then this module keeps only
postings it can show were published within the last MAX_AGE_MIN minutes."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from urllib.parse import urlsplit

from . import analyzer

WANT = 5
MAX_AGE_MIN = 120

JOBS_TOOL = {
    "name": "record_jobs",
    "description": "Record the job postings found.",
    "input_schema": {
        "type": "object",
        "properties": {
            "profile": {"type": "string",
                        "description": "One line: the roles, seniority, core skills and location you searched for"},
            "jobs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "company": {"type": "string"},
                        "location": {"type": "string", "description": "City, region or 'Remote'"},
                        "url": {"type": "string", "description": "Direct link to this one posting"},
                        "posted_at": {"type": "string",
                                      "description": "When it was posted: ISO 8601 with time zone if the page gives "
                                                     "a timestamp, else exactly what the page shows (e.g. '35 minutes ago')"},
                        "posted_age_minutes": {"type": "integer",
                                               "description": "Minutes between posting and the current time given above"},
                        "match_reason": {"type": "string", "description": "One sentence: why it fits this resume"},
                        "source": {"type": "string", "description": "Site it was found on, e.g. LinkedIn, Greenhouse"},
                    },
                    "required": ["title", "company", "url", "posted_at", "posted_age_minutes", "match_reason"],
                },
            },
        },
        "required": ["profile", "jobs"],
    },
}

RULES = f"""How to search:
1. From the resume, work out the target job titles (the candidate's current title and close variants), seniority,
   core skills, and location / remote preference (from the contact line; if none, prefer remote or the country
   of their recent jobs).
2. Search job boards and career sites: LinkedIn Jobs, Indeed, Greenhouse (boards.greenhouse.io), Lever
   (jobs.lever.co), Ashby, Workday (myworkdayjobs.com), Wellfound and company career pages. Search for recency
   explicitly (e.g. "posted 1 hour ago", "past 24 hours", sorted by date) and open postings to read when they
   were posted.
3. Keep only postings you can SEE were posted within the last {MAX_AGE_MIN} minutes of the current time: a
   timestamp, or a relative age like "45 minutes ago" / "1 hour ago". Postings that say "today", "1 day ago",
   "Reposted", or show no posting time do not qualify. Never guess or round down an age.
4. Each url must open that one posting (not a search-results or listing page). Never invent a posting, company
   or url: every job must come from a page you actually saw.
5. Return up to {WANT} jobs, best fit first, no duplicates (same company and title counts as a duplicate).
   If fewer than {WANT} qualify, return only those, even none. Never pad the list with older postings."""

_LISTING = re.compile(r"/jobs/search|/jobs/?$|[?&](q|keywords|query)=|/search\b|google\.\w+/", re.I)


def _age_minutes(job: dict, started: datetime) -> float | None:
    """Age at search time: from an ISO posted_at when there is one, else Claude's posted_age_minutes."""
    raw = str(job.get("posted_at") or "").strip()
    try:
        ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if ts.tzinfo:
            return (started - ts).total_seconds() / 60
    except ValueError:
        pass
    age = job.get("posted_age_minutes")
    return float(age) if isinstance(age, (int, float)) and not isinstance(age, bool) else None


def validate_jobs(raw: dict, started: datetime) -> dict:
    """Keep real, fresh, distinct postings; report what was dropped and why."""
    kept, dropped, seen = [], [], set()
    for j in raw.get("jobs") or []:
        if not isinstance(j, dict):
            continue
        title, company = str(j.get("title") or "").strip(), str(j.get("company") or "").strip()
        url = str(j.get("url") or "").strip()
        label = f"{title or '?'} at {company or '?'}"
        parts = urlsplit(url)
        age = _age_minutes(j, started)
        key_url = (parts.netloc.lower().removeprefix("www.") + parts.path.rstrip("/")).lower()
        key_job = (re.sub(r"\W+", " ", company.lower()).strip(), re.sub(r"\W+", " ", title.lower()).strip())
        if not title or not company:
            why = "no title or company"
        elif parts.scheme not in ("http", "https") or not parts.netloc:
            why = "no valid link"
        elif _LISTING.search(url):
            why = "link is a search page, not a posting"
        elif age is None:
            why = "posting time unknown"
        elif age > MAX_AGE_MIN or age < -10:  # a little slack for clock skew on "just now" postings
            why = f"posted {int(age)} minutes ago" if age > 0 else "posting time is in the future"
        elif key_url in seen or key_job in seen:
            why = "duplicate"
        else:
            seen.update((key_url, key_job))
            kept.append({"title": title, "company": company, "location": str(j.get("location") or "").strip(),
                         "url": url, "posted_at": str(j.get("posted_at") or ""), "age_minutes": max(0, round(age)),
                         "match_reason": str(j.get("match_reason") or "").strip(),
                         "source": str(j.get("source") or parts.netloc.removeprefix("www.")).strip()})
            continue
        dropped.append(f"{label}: {why}")
    return {"profile": str(raw.get("profile") or ""), "jobs": kept[:WANT], "dropped": dropped}


def find_jobs(resume_text: str, started: datetime | None = None) -> dict:
    started = started or datetime.now(timezone.utc)
    user = (f"Current time: {started.strftime('%Y-%m-%dT%H:%M')}Z (UTC).\n\n"
            f"Candidate's resume:\n<resume>\n{resume_text.strip()[:12000]}\n</resume>\n\n"
            f"Find {WANT} job postings that fit this candidate and were posted within the last {MAX_AGE_MIN} minutes.\n\n"
            + RULES)
    system = ("You are a meticulous job researcher. You report only postings you have actually seen on the web, "
              "with their exact links and posting times.")
    return validate_jobs(analyzer._call_tool(system, user, JOBS_TOOL, 8000), started)
