"""Fetch a job description from a URL.

Strategy (first one that yields a real JD wins):
  1. LinkedIn job links  -> LinkedIn's public guest job-posting page
  2. Plain HTTP fetch     -> schema.org JobPosting JSON-LD (Workday, Lever, Greenhouse, iCIMS, most ATSs)
  3. Plain HTTP fetch     -> main-content extraction (trafilatura)
  4. Headless browser     -> same two extractors on the JS-rendered page (Playwright, optional)
If all fail, the UI asks the user to paste the JD text.
"""
from __future__ import annotations

import html as htmllib
import json
import re
from urllib.parse import parse_qs, urlparse

import requests
import trafilatura
from bs4 import BeautifulSoup

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
HEADERS = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9",
           "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}
MIN_LEN = 400  # characters; anything shorter is probably a login wall / cookie banner


class FetchError(RuntimeError):
    pass


def html_to_text(fragment: str) -> str:
    soup = BeautifulSoup(htmllib.unescape(fragment or ""), "html.parser")
    for li in soup.find_all("li"):
        li.insert_before("\n• ")
    for tag in soup.find_all(["p", "div", "br", "h1", "h2", "h3", "h4", "ul", "ol"]):
        tag.insert_after("\n")
    text = soup.get_text()
    text = re.sub(r"[ \t\xa0]+", " ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
    return "\n".join(l.strip() for l in text.splitlines()).strip()


def _from_jsonld(page_html: str) -> dict | None:
    soup = BeautifulSoup(page_html, "html.parser")
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or tag.get_text() or "")
        except (json.JSONDecodeError, TypeError):
            continue
        stack = data if isinstance(data, list) else [data]
        while stack:
            node = stack.pop()
            if isinstance(node, dict):
                t = node.get("@type")
                if t == "JobPosting" or (isinstance(t, list) and "JobPosting" in t):
                    desc = html_to_text(node.get("description", ""))
                    org = node.get("hiringOrganization") or {}
                    company = org.get("name") if isinstance(org, dict) else str(org)
                    title = node.get("title") or ""
                    extra = []
                    for k, label in (("qualifications", "Qualifications"), ("skills", "Skills"),
                                     ("responsibilities", "Responsibilities"),
                                     ("experienceRequirements", "Experience")):
                        v = node.get(k)
                        if isinstance(v, str) and v.strip():
                            extra.append(f"{label}:\n{html_to_text(v)}")
                    full = "\n\n".join([f"{title}" + (f" — {company}" if company else ""), desc] + extra)
                    if len(desc) >= MIN_LEN // 2:
                        return {"text": full.strip(), "title": title, "company": company or ""}
                stack.extend(v for v in node.values() if isinstance(v, (dict, list)))
            elif isinstance(node, list):
                stack.extend(node)
    return None


def _from_main_content(page_html: str, url: str) -> dict | None:
    text = trafilatura.extract(page_html, url=url, include_tables=True, include_comments=False,
                               favor_recall=True) or ""
    if len(text) < MIN_LEN:
        return None
    meta = trafilatura.extract_metadata(page_html)
    return {"text": text.strip(), "title": (meta.title if meta else "") or "",
            "company": (meta.sitename if meta else "") or ""}


def _extract(page_html: str, url: str) -> dict | None:
    return _from_jsonld(page_html) or _from_main_content(page_html, url)


def _linkedin_id(url: str) -> str | None:
    u = urlparse(url)
    if "linkedin.com" not in u.netloc:
        return None
    q = parse_qs(u.query)
    if q.get("currentJobId"):
        return q["currentJobId"][0]
    m = re.search(r"/jobs/view/(?:[^/]*-)?(\d{6,})", u.path)
    return m.group(1) if m else None


def _linkedin(job_id: str) -> dict | None:
    r = requests.get(f"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{job_id}",
                     headers=HEADERS, timeout=20)
    if r.status_code != 200:
        return None
    soup = BeautifulSoup(r.text, "html.parser")
    body = soup.select_one(".show-more-less-html__markup, .description__text")
    if not body:
        return None
    title = (soup.select_one(".top-card-layout__title, h2") or soup.new_tag("x")).get_text(strip=True)
    company = (soup.select_one(".topcard__org-name-link, .topcard__flavor") or soup.new_tag("x")).get_text(strip=True)
    criteria = [li.get_text(" ", strip=True) for li in soup.select(".description__job-criteria-item")]
    text = f"{title} — {company}\n\n{html_to_text(str(body))}"
    if criteria:
        text += "\n\n" + "\n".join(criteria)
    return {"text": text, "title": title, "company": company}


def _ats_api(url: str) -> dict | None:
    """Public JSON APIs of common applicant-tracking systems (no JavaScript rendering needed)."""
    u = urlparse(url)
    host, parts = u.netloc.lower(), [x for x in u.path.split("/") if x]

    # Workday: https://{tenant}.wd5.myworkdayjobs.com/[en-US/]{site}/job/{location}/{slug}
    if "myworkdayjobs.com" in host and "job" in parts:
        if re.fullmatch(r"[a-z]{2}-[A-Z]{2}", parts[0]):
            parts = parts[1:]
        tenant = host.split(".")[0]
        api = f"https://{host}/wday/cxs/{tenant}/{parts[0]}/" + "/".join(parts[1:])
        r = requests.get(api, headers={**HEADERS, "Accept": "application/json"}, timeout=20)
        if r.ok:
            info = r.json().get("jobPostingInfo", {})
            org = (r.json().get("hiringOrganization") or {}).get("name", "") or tenant.title()
            if info.get("jobDescription"):
                return {"text": f'{info.get("title", "")} — {org}\n\n' + html_to_text(info["jobDescription"]),
                        "title": info.get("title", ""), "company": org, "method": "Workday API"}

    # Greenhouse: boards.greenhouse.io/{board}/jobs/{id}  or  job-boards.greenhouse.io/{board}/jobs/{id}
    if "greenhouse.io" in host and "jobs" in parts:
        i = parts.index("jobs")
        if i >= 1 and i + 1 < len(parts):
            r = requests.get(f"https://boards-api.greenhouse.io/v1/boards/{parts[i-1]}/jobs/{parts[i+1]}",
                             headers=HEADERS, timeout=20)
            if r.ok:
                j = r.json()
                company = (j.get("company_name") or parts[i - 1]).strip()
                return {"text": f'{j.get("title", "")} — {company}\n\n' + html_to_text(j.get("content", "")),
                        "title": j.get("title", ""), "company": company, "method": "Greenhouse API"}

    # Lever: jobs.lever.co/{company}/{uuid}
    if host == "jobs.lever.co" and len(parts) >= 2:
        r = requests.get(f"https://api.lever.co/v0/postings/{parts[0]}/{parts[1]}", headers=HEADERS, timeout=20)
        if r.ok:
            j = r.json()
            body = [j.get("descriptionPlain") or html_to_text(j.get("description", ""))]
            for lst in j.get("lists", []):
                body.append(f'{lst.get("text", "")}:\n{html_to_text(lst.get("content", ""))}')
            body.append(j.get("additionalPlain", ""))
            return {"text": f'{j.get("text", "")} — {parts[0].title()}\n\n' + "\n\n".join(b for b in body if b),
                    "title": j.get("text", ""), "company": parts[0].title(), "method": "Lever API"}
    return None


def playwright_available() -> bool:
    try:
        import playwright.sync_api  # noqa: F401
        return True
    except ImportError:
        return False


def _render_with_browser(url: str) -> str:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(user_agent=UA)
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                pass
            page.wait_for_timeout(1500)
            return page.content()
        finally:
            browser.close()


def fetch_jd(url: str) -> dict:
    url = (url or "").strip()
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    notes = []

    job_id = _linkedin_id(url)
    if job_id:
        try:
            res = _linkedin(job_id)
            if res:
                return {**res, "method": "LinkedIn public posting", "url": url}
            notes.append("LinkedIn guest page had no description")
        except requests.RequestException as e:
            notes.append(f"LinkedIn: {e}")

    try:
        res = _ats_api(url)
        if res:
            return {**res, "url": url}
    except (requests.RequestException, ValueError) as e:
        notes.append(f"job-board API: {e.__class__.__name__}")

    try:
        r = requests.get(url, headers=HEADERS, timeout=25, allow_redirects=True)
        if r.status_code < 400:
            res = _extract(r.text, r.url)
            if res:
                return {**res, "method": "Direct fetch", "url": url}
            notes.append("page loaded but no job text found (likely rendered by JavaScript)")
        else:
            notes.append(f"site returned HTTP {r.status_code}")
    except requests.RequestException as e:
        notes.append(f"direct fetch failed: {e.__class__.__name__}")

    if playwright_available():
        try:
            res = _extract(_render_with_browser(url), url)
            if res:
                return {**res, "method": "Headless browser", "url": url}
            notes.append("browser rendered the page but no job text was found (login wall?)")
        except Exception as e:  # browser missing, timeout, etc.
            msg = str(e).splitlines()[0][:160]
            if "Executable doesn't exist" in str(e):
                msg = "browser not installed — run: python -m playwright install chromium"
            notes.append(f"headless browser: {msg}")
    else:
        notes.append("headless browser not installed (optional: pip install playwright)")

    raise FetchError("Couldn't read the job description from that link — " + "; ".join(notes)
                     + ". Paste the JD text instead.")
