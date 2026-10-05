"""Browser check: loading a resume starts the job search by itself, the fresh postings are listed, and each one opens
in its own tab that loads the same resume, fetches that posting and starts the analysis (no search there).
Mock server + Playwright.
Skips when Playwright isn't installed."""
import os, sys, socket, subprocess, time, urllib.request
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("SKIP: Playwright not installed"); sys.exit(0)

ROOT = Path(__file__).resolve().parent.parent
with socket.socket() as s:
    s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]
URL = f"http://127.0.0.1:{PORT}/"
env = {**os.environ, "MOCK_DELAY": "0.3", "HOME": str(Path(os.environ.get("TMPDIR", "/tmp")) / f"ro-findjobs-{PORT}")}
server = subprocess.Popen([sys.executable, str(ROOT / "tests" / "mock_server.py"), str(PORT)], cwd=ROOT, env=env)

try:
    for _ in range(60):
        try:
            urllib.request.urlopen(URL + "api/config"); break
        except OSError:
            time.sleep(0.25)
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context()
        pg = ctx.new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_timeout(400)
        if pg.locator("#settingsDlg").count(): pg.keyboard.press("Escape")

        # 1) the finder is a required step: shown, waiting for the resume, no button to start it by hand
        assert pg.is_visible("#findCard") and pg.is_hidden("#findJobsBtn")
        assert "starts by itself" in pg.inner_text("#findStatus")
        assert pg.inner_text("#findCard .step-no") == "2" and "Optional" not in pg.inner_text("#findCard")
        assert pg.title() == "Resume Optimizer"

        # 2) loading the resume starts the search: two fresh postings listed, the day-old one left out
        pg.set_input_files("#uploadInput", str(ROOT / "tests" / "sample_resume.docx"))
        pg.wait_for_selector("#resumeStatus.ok", timeout=5000)
        pg.wait_for_selector("#findCancel:not([hidden])", timeout=3000)
        pg.wait_for_selector("#findResults:not([hidden])", timeout=8000)
        assert pg.is_visible("#findJobsBtn") and pg.inner_text("#findJobsBtn") == "Search again"
        assert pg.locator(".job").count() == 2
        st = pg.inner_text("#findStatus")
        assert "Found 2 jobs posted in the last 2 hours (fewer than 5 qualified)" in st and "1 older" in st, st
        assert "Globex" in pg.inner_text(".job >> nth=0") and "posted 35 min ago" in pg.inner_text(".job >> nth=0")

        # 2b) loading the same resume again doesn't search again; Search again does
        pg.set_input_files("#uploadInput", str(ROOT / "tests" / "sample_resume.docx"))
        pg.wait_for_timeout(600)
        assert pg.is_hidden("#findCancel") and pg.is_visible("#findResults")
        pg.click("#findJobsBtn")
        pg.wait_for_selector("#findCancel:not([hidden])", timeout=3000)
        pg.wait_for_selector("#findResults:not([hidden])", timeout=8000)
        assert pg.locator(".job").count() == 2

        # 3) a job opens in a new tab: own session, posting fetched, analysis started, title names the job
        with ctx.expect_page() as new:
            pg.click('[data-open="0"]')
        tab = new.value
        tab.on("pageerror", lambda e: errs.append(str(e)))
        tab.wait_for_load_state()
        if tab.locator("#settingsDlg").count(): tab.keyboard.press("Escape")
        tab.wait_for_selector("#reviewView:not([hidden])", timeout=15000)
        assert "Globex" in tab.title() and tab.url == URL, (tab.title(), tab.url)
        assert tab.is_hidden("#findCard") and tab.input_value("#jdUrl") == "https://jobs.example.test/globex"
        assert tab.evaluate("__ro.state().searchedFor") == "" and tab.inner_text("#jdStepNo") == "2"  # no search in a job's tab
        sid_main = pg.evaluate("__ro.state().resume.session_id"); sid_tab = tab.evaluate("__ro.state().resume.session_id")
        assert sid_main != sid_tab
        assert "Opened in a new tab" in pg.inner_text('[data-open="0"]')

        # 4) the first tab is untouched: still on setup, no job filled in
        assert pg.is_visible("#setupView") and pg.input_value("#jdUrl") == "" and pg.title() == "Resume Optimizer"

        # 5) Tailor all opens one tab per job
        n = len(ctx.pages)
        pg.click("#tailorAll"); pg.wait_for_timeout(1000)
        assert len(ctx.pages) == n + 2, len(ctx.pages)
        assert errs == [], errs
        b.close()
    print("FIND JOBS UI TEST PASSED")
finally:
    server.terminate(); server.wait(5)
