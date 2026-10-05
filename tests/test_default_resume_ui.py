"""Browser check: the default resume loads on start and starts the job search with no clicks; "Use a different
resume" swaps in another one for the session, "Back to default" restores it, "Make this my default" changes it, a
job tab clones the parent tab's resume (not the default), and clearing the default in Settings means the next start
shows the empty drop zone. Mock server + Playwright.
Skips when Playwright isn't installed."""
import json, os, shutil, sys, socket, subprocess, time, urllib.request
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("SKIP: Playwright not installed"); sys.exit(0)

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from ro.config import SEED_DEFAULT_RESUME

with socket.socket() as s:
    s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]
URL = f"http://127.0.0.1:{PORT}/"
HOME = Path(os.environ.get("TMPDIR", "/tmp")) / f"ro-default-{PORT}"
shutil.rmtree(HOME, ignore_errors=True)
SEED = HOME / SEED_DEFAULT_RESUME
SEED.parent.mkdir(parents=True)
shutil.copy(ROOT / "tests" / "sample_resume.docx", SEED)
OTHER = HOME / "Other_Resume.docx"
shutil.copy(ROOT / "tests" / "sample_resume.docx", OTHER)
env = {**os.environ, "MOCK_DELAY": "0.3", "HOME": str(HOME)}
server = subprocess.Popen([sys.executable, str(ROOT / "tests" / "mock_server.py"), str(PORT)], cwd=ROOT, env=env)
config = lambda: json.load(urllib.request.urlopen(URL + "api/config"))


def start(pg):
    pg.goto(URL); pg.wait_for_timeout(400)
    if pg.locator("#settingsDlg").count(): pg.keyboard.press("Escape"); pg.wait_for_timeout(300)


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

        # 1) fresh start: the default loads by itself, tagged Default, and the job search starts
        start(pg)
        pg.wait_for_selector("#defaultResume", timeout=5000)
        pg.wait_for_selector("#resumeStatus.ok", timeout=5000)
        card = pg.inner_text("#defaultResume")
        assert SEED.name in card and "Default" in card, card
        assert pg.locator("#dropzone").count() == 0 and pg.is_visible("#useDifferentBtn")
        pg.wait_for_selector("#findResults:not([hidden])", timeout=8000)
        assert pg.locator(".job").count() == 2

        # 2) Use a different resume: the drop zone comes back; Keep my default closes it again
        pg.click("#useDifferentBtn")
        pg.wait_for_selector("#dropzone")
        assert "Drop a different resume here" in pg.inner_text("#dropzone") and pg.is_visible("#keepDefaultBtn")
        pg.click("#keepDefaultBtn")
        pg.wait_for_selector("#defaultResume")
        pg.click("#useDifferentBtn")
        pg.wait_for_selector("#dropzone")

        # 3) another file is used for this session, with Back to default; the default doesn't change
        pg.set_input_files("#uploadInput", str(OTHER))
        pg.wait_for_function("document.querySelector('#dropzone')?.innerText.includes('Other_Resume.docx')", timeout=5000)
        assert pg.locator("#defaultResume").count() == 0
        pg.wait_for_selector("#backToDefaultBtn"); assert pg.is_visible("#makeDefaultBtn")
        assert pg.evaluate("__ro.state().resumeIsDefault") is False
        assert config()["default_resume_path"] == str(SEED.resolve())

        # 4) a job tab clones this tab's resume, not the default
        pg.wait_for_function("!__ro.state().findRunning && __ro.state().found", timeout=8000)  # searched for this resume
        with ctx.expect_page() as new:
            pg.click('[data-open="0"]')
        tab = new.value
        tab.on("pageerror", lambda e: errs.append(str(e)))
        tab.wait_for_load_state()
        tab.wait_for_function("window.__ro && __ro.state().resume", timeout=8000)
        assert tab.evaluate("__ro.state().resume.file_name") == "Other_Resume.docx"
        tab.close()

        # 5) Back to default restores the default
        pg.click("#backToDefaultBtn")
        pg.wait_for_selector("#defaultResume", timeout=5000)
        assert SEED.name in pg.inner_text("#defaultResume")

        # 6) Make this my default: another resume becomes the default
        pg.click("#useDifferentBtn"); pg.wait_for_selector("#dropzone")
        pg.set_input_files("#uploadInput", str(OTHER))
        pg.wait_for_selector("#makeDefaultBtn", timeout=5000)
        pg.click("#makeDefaultBtn")
        pg.wait_for_selector("#defaultResume", timeout=5000)
        assert "Other_Resume.docx" in pg.inner_text("#defaultResume")
        assert config()["default_resume_path"].endswith("Other_Resume.docx")

        # 7) Settings shows it; Clear + Save turns auto-load off, and the next start has the empty drop zone
        pg.click("#settingsBtn"); pg.wait_for_selector("#settingsDlg")
        assert pg.input_value("#defaultResumeIn").endswith("Other_Resume.docx")
        pg.click("#defaultResumeClear")
        assert pg.input_value("#defaultResumeIn") == ""
        pg.click("#saveSettings"); pg.wait_for_selector("#settingsDlg", state="detached")
        assert config()["default_resume_path"] == ""
        pg.wait_for_selector("#dropzone")  # the loaded resume is no longer the default
        assert pg.evaluate("__ro.state().resumeIsDefault") is False
        start(pg)
        pg.wait_for_timeout(600)
        assert pg.locator("#defaultResume").count() == 0
        assert "Drop your resume here" in pg.inner_text("#dropzone")
        assert pg.evaluate("__ro.state().resume") is None and "starts by itself" in pg.inner_text("#findStatus")
        assert errs == [], errs
        b.close()
    print("DEFAULT RESUME UI TEST PASSED")
finally:
    server.terminate(); server.wait(5)
    shutil.rmtree(HOME, ignore_errors=True)
