"""Per-machine configuration stored in ~/.resume-optimizer (works on macOS, Windows, Linux)."""
from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import load_dotenv

APP_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = Path.home() / ".resume-optimizer"
CONFIG_FILE = CONFIG_DIR / "config.json"
ENV_FILE = CONFIG_DIR / ".env"
UPLOAD_DIR = CONFIG_DIR / "uploads"

DEFAULT_MODEL = "claude-sonnet-5"


def ensure_dirs() -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def load_env() -> None:
    """Load API key: project .env first, then the per-user one (per-user wins)."""
    load_dotenv(APP_DIR / ".env", override=False)
    load_dotenv(ENV_FILE, override=True)


def load_config() -> dict:
    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_config(**updates) -> dict:
    ensure_dirs()
    cfg = load_config()
    cfg.update({k: v for k, v in updates.items() if v is not None})
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    return cfg


def get_model() -> str:
    return os.environ.get("ANTHROPIC_MODEL") or load_config().get("model") or DEFAULT_MODEL


ENGINES = ("auto", "claude_code", "api")


def get_engine_pref() -> str:
    e = load_config().get("engine", "auto")
    return e if e in ENGINES else "auto"


def active_engine() -> str:
    """'claude_code' (your Claude subscription) or 'api' (API key)."""
    from .claude_code import find_claude
    pref = get_engine_pref()
    if pref == "auto":
        return "claude_code" if find_claude() else "api"
    return pref


DOC_FONTS = ("EB Garamond", "keep")


def get_doc_font() -> str:
    """Font for downloaded resumes and letters: EB Garamond, or "keep" the resume's own font."""
    f = load_config().get("doc_font", "EB Garamond")
    return f if f in DOC_FONTS else "EB Garamond"


FILE_FORMATS = ("pdf", "docx", "both")


def get_file_format() -> str:
    """What Download saves: a PDF (default), the .docx, or both."""
    f = load_config().get("file_format", "pdf")
    return f if f in FILE_FORMATS else "pdf"


def get_name_override() -> str:
    """The candidate's name for file names when the resume's own name line isn't detected well."""
    return (load_config().get("name_override") or "").strip()


def get_bold_keywords() -> bool:
    return bool(load_config().get("bold_keywords", True))


# Seeded as the default resume the first time config is read, if it's on this computer. Relative to the home
# folder, so a test run with a temporary HOME never picks it up.
SEED_DEFAULT_RESUME = Path("Documents") / "Resume" / "FullTime" / "Yashwanth_Varre_Software_Engineer_Resume.docx"


def get_default_resume_path() -> str:
    """The resume loaded automatically on start ("" = none: start with an empty drop zone).

    A saved "" means the user cleared it, so the seed is only used while the key has never been set."""
    cfg = load_config()
    if "default_resume_path" in cfg:
        return cfg["default_resume_path"] or ""
    seed = Path.home() / SEED_DEFAULT_RESUME
    if seed.is_file():
        save_config(default_resume_path=str(seed.resolve()))
        return str(seed.resolve())
    return ""


def get_cc_model() -> str:
    return load_config().get("cc_model", "sonnet")


def has_api_key() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def save_api_key(key: str) -> None:
    """Persist the key in ~/.resume-optimizer/.env (readable only by the current user)."""
    ensure_dirs()
    lines = []
    if ENV_FILE.exists():
        lines = [l for l in ENV_FILE.read_text(encoding="utf-8").splitlines()
                 if not l.startswith("ANTHROPIC_API_KEY=")]
    lines.append(f"ANTHROPIC_API_KEY={key.strip()}")
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        os.chmod(ENV_FILE, 0o600)
    except OSError:
        pass  # Windows ignores POSIX modes
    os.environ["ANTHROPIC_API_KEY"] = key.strip()
