"""Default resume: seeded from ~/Documents/Resume/FullTime when it exists, returned by /api/config, saved (checked)
and cleared through /api/settings. A cleared default stays cleared."""
import os, sys, json, shutil, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
_home = tempfile.mkdtemp(); os.environ["HOME"] = os.environ["USERPROFILE"] = _home  # keep real config untouched
from fastapi.testclient import TestClient
import app as appmod
from ro import config

SAMPLE = Path(__file__).parent / "sample_resume.docx"
c = TestClient(appmod.app)
cfg = lambda: c.get("/api/config").json()
stored = lambda: json.loads(config.CONFIG_FILE.read_text(encoding="utf-8")) if config.CONFIG_FILE.exists() else {}

# 1) no seed file in this HOME: no default, nothing written
assert cfg()["default_resume_path"] == ""
assert "default_resume_path" not in stored()

# 2) the seed file appears: it becomes the default and is saved in config.json
seed = Path(_home) / config.SEED_DEFAULT_RESUME
seed.parent.mkdir(parents=True)
shutil.copy(SAMPLE, seed)
assert cfg()["default_resume_path"] == str(seed.resolve())
assert stored()["default_resume_path"] == str(seed.resolve())

# 3) saving a different file: resolved (~ expanded), must exist, must be a resume type
other = Path(_home) / "Other Resume.docx"
shutil.copy(SAMPLE, other)
r = c.post("/api/settings", json={"default_resume_path": '"~/Other Resume.docx"'})
assert r.status_code == 200 and r.json()["default_resume_path"] == str(other.resolve()), r.text
r = c.post("/api/settings", json={"default_resume_path": "~/missing.docx"})
assert r.status_code == 400 and "Nothing found" in r.json()["detail"], r.text
(Path(_home) / "notes.xyz").write_text("x")
r = c.post("/api/settings", json={"default_resume_path": "~/notes.xyz"})
assert r.status_code == 400 and "Unsupported" in r.json()["detail"], r.text
r = c.post("/api/settings", json={"default_resume_path": _home})
assert r.status_code == 400 and "folder" in r.json()["detail"], r.text
assert cfg()["default_resume_path"] == str(other.resolve())  # failed saves changed nothing

# 4) other settings saved alongside an unchanged default don't re-check it (the file may have gone meanwhile)
other.unlink()
r = c.post("/api/settings", json={"default_resume_path": str(other.resolve()), "file_format": "docx"})
assert r.status_code == 200 and r.json()["file_format"] == "docx", r.text
shutil.copy(SAMPLE, other)

# 5) omitting the field leaves it alone
assert c.post("/api/settings", json={"bold_keywords": False}).json()["default_resume_path"] == str(other.resolve())

# 6) clearing turns auto-load off for good: the seed (still on disk) doesn't come back
r = c.post("/api/settings", json={"default_resume_path": "  "})
assert r.status_code == 200 and r.json()["default_resume_path"] == "", r.text
assert stored()["default_resume_path"] == ""
assert seed.exists() and cfg()["default_resume_path"] == ""

# 7) loading a resume still records last_resume_path and leaves the default alone
d = c.post("/api/resume/load", json={"path": str(other)}).json()
assert cfg()["last_resume_path"] == d["path"] and cfg()["default_resume_path"] == ""

print("default resume OK")
