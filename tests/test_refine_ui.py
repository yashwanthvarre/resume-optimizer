"""Browser check: in the Ask Claude popover, Enter applies the instruction to the line and closes the popover (a user
edit Reset undoes), a flagged rewrite waits for Use it / Discard, Ctrl+Enter still gives 3 options, and a
request that reaches another role ("add this keyword in X") makes edits there.
Mock server + Playwright. Skips when Playwright isn't installed."""
import os, shutil, sys, socket, subprocess, time, urllib.request
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("SKIP: Playwright not installed"); sys.exit(0)

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from ro.config import SEED_DEFAULT_RESUME
from test_e2e_data import JD_TEXT

with socket.socket() as s:
    s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]
URL = f"http://127.0.0.1:{PORT}/"
HOME = Path(os.environ.get("TMPDIR", "/tmp")) / f"ro-refine-{PORT}"
shutil.rmtree(HOME, ignore_errors=True)
(HOME / SEED_DEFAULT_RESUME).parent.mkdir(parents=True)
shutil.copy(ROOT / "tests" / "sample_resume.docx", HOME / SEED_DEFAULT_RESUME)
env = {**os.environ, "MOCK_DELAY": "0.3", "HOME": str(HOME)}
server = subprocess.Popen([sys.executable, str(ROOT / "tests" / "mock_server.py"), str(PORT)], cwd=ROOT, env=env)


def open_ask(pg):
    """Open the popover on the first highlighted line; returns (change id, line text before)."""
    btn = pg.locator("#preview .ask").first
    btn.scroll_into_view_if_needed(); btn.dispatch_event("click")  # the spark only shows on hover
    pg.wait_for_selector("#refinePop #refineAsk")
    cid = btn.get_attribute("data-ask")
    return cid, pg.inner_text("#refineLine")


try:
    for _ in range(60):
        try:
            urllib.request.urlopen(URL + "api/config"); break
        except OSError:
            time.sleep(0.25)
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_timeout(400)
        if pg.locator("#settingsDlg").count(): pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
        pg.wait_for_selector("#resumeStatus.ok", timeout=8000)
        if not pg.locator("#jdText").count(): pg.click("#pasteLink")
        pg.fill("#jdText", JD_TEXT)
        pg.wait_for_selector("#analyzeBtn:not([disabled])", timeout=5000); pg.click("#analyzeBtn")
        pg.wait_for_selector("#preview .ask", state="attached", timeout=15000)

        # 1) Enter applies the instruction: the line changes, the popover closes, it's the user's edit
        cid, before = open_ask(pg)
        assert pg.is_visible("#refineApply") and pg.is_visible("#refineGo")
        assert pg.is_disabled("#refineApply"), "nothing to apply yet"
        pg.fill("#refineAsk", "use a stronger verb")
        pg.press("#refineAsk", "Shift+Enter")  # a new line, not a submit
        assert pg.input_value("#refineAsk") == "use a stronger verb\n" and pg.locator("#refineStop").count() == 0
        pg.fill("#refineAsk", "use a stronger verb"); pg.press("#refineAsk", "Enter")
        pg.wait_for_selector("#refinePop", state="detached", timeout=8000)
        edit = pg.evaluate(f"__ro.state().edits[{cid!r}]")
        assert edit and edit.split()[0].lstrip("•●▪■◦‣∙·-–* ") in ("Developed", "Built"), edit
        assert edit.strip() != before.strip(), (edit, before)
        assert pg.locator(".toast", has_text="Applied: use a stronger verb").count(), pg.inner_text("body")[:500]
        pg.click(f'#preview [data-change="{cid}"]', force=True)  # its popover: Reset brings Claude's edit back
        pg.click("text=Reset")
        assert pg.evaluate(f"__ro.state().edits[{cid!r}]") is None
        pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
        print("ok: Enter applies, Reset undoes")

        # 2) a flagged rewrite doesn't go in by itself: Discard keeps the line, Use it applies it
        cid, before = open_ask(pg)
        pg.fill("#refineAsk", "say it was for 40 teams"); pg.click("#refineApply")
        pg.wait_for_selector("#refineApplied", timeout=8000)
        assert "40" in pg.inner_text("#refineApplied") and pg.locator("#refineApplied .warn").count()
        assert pg.evaluate(f"__ro.state().edits[{cid!r}]") is None
        pg.click("#refineDiscard"); pg.wait_for_selector("#refineApplied", state="detached")
        assert pg.is_visible("#refinePop") and pg.evaluate(f"__ro.state().edits[{cid!r}]") is None
        pg.click("#refineApply"); pg.wait_for_selector("#refineUse", timeout=8000); pg.click("#refineUse")
        pg.wait_for_selector("#refinePop", state="detached")
        assert "40 teams" in pg.evaluate(f"__ro.state().edits[{cid!r}]")
        print("ok: flagged rewrite waits for Use it / Discard")

        # 3) Ctrl+Enter still gives 3 options to pick from
        open_ask(pg)
        pg.fill("#refineAsk", "make it shorter"); pg.press("#refineAsk", "Control+Enter")
        pg.wait_for_selector("#refineOptions", timeout=8000)
        assert pg.locator("#refineOptions .refine-opt").count() == 3
        assert pg.is_visible("#refinePop")
        print("ok: Ctrl+Enter gives 3 options")

        # 4) a request that reaches another role: Claude's edits land on the page, the hovered line stays
        pg.click("text=Cancel"); pg.wait_for_selector("#refinePop", state="detached")
        cid, before = open_ask(pg)
        kept = pg.evaluate(f"__ro.state().edits[{cid!r}]")
        pg.fill("#refineAsk", "Add this keyword in the Acme exp and keep the keyword in skills"); pg.press("#refineAsk", "Enter")
        pg.wait_for_selector("#refinePop", state="detached", timeout=8000)
        asks = pg.evaluate("__ro.state().analysis.changes.filter((c) => c.source === 'ask').map((c) => c.new_text)")
        assert any("Mentored two new hires" in t for t in asks), asks
        assert pg.evaluate(f"__ro.state().edits[{cid!r}]") == kept, "the hovered line isn't rewritten"
        assert pg.locator(".toast", has_text="added a mentoring bullet").count(), pg.inner_text("body")[:500]
        print("ok: request beyond the line edits elsewhere")

        assert errs == [], errs
        b.close()
    print("REFINE UI TEST PASSED")
finally:
    server.terminate(); server.wait(5)
