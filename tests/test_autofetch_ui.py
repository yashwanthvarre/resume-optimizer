"""Browser check: the job link is fetched by itself, once per URL (mock server + Playwright).
Skips when Playwright isn't installed."""
import os, sys, socket, subprocess, time, json, urllib.request
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("SKIP: Playwright not installed"); sys.exit(0)

ROOT = Path(__file__).resolve().parent.parent
with socket.socket() as s:
    s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]
URL = f"http://127.0.0.1:{PORT}/"
env = {**os.environ, "MOCK_DELAY": "0.8", "HOME": str(Path(os.environ.get("TMPDIR", "/tmp")) / f"ro-autofetch-{PORT}")}
server = subprocess.Popen([sys.executable, str(ROOT / "tests" / "mock_server.py"), str(PORT)], cwd=ROOT, env=env)


def fetches():
    return json.load(urllib.request.urlopen(URL + "api/_mock/fetches"))


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
        if pg.locator("#settingsDlg[open]").count(): pg.keyboard.press("Escape")

        # 1) typing: one fetch ~600ms after typing stops; blur / Enter on the same URL don't refetch
        pg.click("#jdUrl"); pg.keyboard.type("https://jobs.example.test/1", delay=25)
        pg.wait_for_timeout(300); assert fetches() == [], "fetched while still typing"
        pg.wait_for_timeout(500)
        assert "Fetching posting" in pg.inner_text("#jdStatus"), pg.inner_text("#jdStatus")
        assert pg.is_disabled("#analyzeBtn")
        pg.wait_for_selector("#jdStatus.ok", timeout=5000)
        pg.keyboard.press("Enter"); pg.locator("#jdUrl").blur(); pg.wait_for_timeout(1200)
        assert fetches() == ["https://jobs.example.test/1"], fetches()
        assert "Backend Engineer" in pg.input_value("#jdText")

        # 2) a new URL mid-fetch cancels the old one; only the newest result lands
        pg.fill("#jdUrl", "https://jobs.example.test/2"); pg.dispatch_event("#jdUrl", "paste")
        pg.wait_for_timeout(250)
        pg.fill("#jdUrl", "https://jobs.example.test/3"); pg.dispatch_event("#jdUrl", "paste")
        pg.wait_for_selector("#jdStatus.ok", timeout=5000); pg.wait_for_timeout(1000)
        f = fetches()
        assert f[-1] == "https://jobs.example.test/3" and f.count("https://jobs.example.test/3") == 1, f

        # 3) failure: Retry label, and Retry fetches the same URL again
        pg.fill("#jdUrl", "https://jobs.example.test/fail"); pg.dispatch_event("#jdUrl", "paste")
        pg.wait_for_selector("#jdStatus.err", timeout=5000)
        assert pg.inner_text("#fetchBtn") == "Retry"
        n = len(fetches()); pg.click("#fetchBtn"); pg.wait_for_selector("#jdStatus.err", timeout=5000); pg.wait_for_timeout(200)
        assert len(fetches()) == n + 1

        # 4) not a link: nothing happens
        n = len(fetches()); pg.fill("#jdUrl", "backend engineer"); pg.dispatch_event("#jdUrl", "paste"); pg.wait_for_timeout(900)
        assert len(fetches()) == n
        assert errs == [], errs
        b.close()
    print("AUTO-FETCH UI TEST PASSED")
finally:
    server.terminate(); server.wait(5)
