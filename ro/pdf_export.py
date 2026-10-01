"""Turn the finished .docx into a PDF that looks exactly like it.

Converters, first found wins: LibreOffice (headless) → Microsoft Word via docx2pdf (macOS/Windows).
EB Garamond and an English hyphenation dictionary ship in ro/fonts and ro/hyphen, so the PDF embeds
the font and justified lines hyphenate even on a computer that has neither installed.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from . import jobs

HERE = Path(__file__).resolve().parent
FONT_DIR = HERE / "fonts"
HYPHEN_DIR = HERE / "hyphen"
TIMEOUT = 90
_LO_LOCK = threading.Lock()   # one LibreOffice at a time: two instances can't share a profile
INSTALL_URL = "https://www.libreoffice.org/download/"


class PdfError(Exception):
    pass


def find_soffice() -> str | None:
    for name in ("soffice", "libreoffice"):
        exe = shutil.which(name)
        if exe:
            return exe
    candidates = {
        "darwin": ["/Applications/LibreOffice.app/Contents/MacOS/soffice"],
        "win32": [rf"{os.environ.get(v, '')}\LibreOffice\program\soffice.exe"
                  for v in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA") if os.environ.get(v)],
    }.get(sys.platform, ["/usr/bin/soffice", "/usr/lib/libreoffice/program/soffice", "/opt/libreoffice/program/soffice",
                         "/snap/bin/libreoffice"])
    return next((c for c in candidates if Path(c).is_file()), None)


def has_word() -> bool:
    """Microsoft Word through docx2pdf (it drives Word itself, so only macOS / Windows)."""
    if sys.platform not in ("darwin", "win32"):
        return False
    try:
        import docx2pdf  # noqa: F401
    except ImportError:
        return False
    if sys.platform == "darwin":
        return Path("/Applications/Microsoft Word.app").exists()
    return True


def converter() -> str:
    """'libreoffice', 'word' or '' when neither is available."""
    if find_soffice():
        return "libreoffice"
    if has_word():
        return "word"
    return ""


def missing_message() -> str:
    return f"PDF export needs LibreOffice (free, {INSTALL_URL}) or Microsoft Word."


# --------------------------------------------------------------------------- LibreOffice
def _profile() -> Path:
    """A private LibreOffice profile, so we never collide with a LibreOffice window the user has open.
    Bundled fonts go in its user/fonts folder, which LibreOffice loads on every platform."""
    base = Path(tempfile.gettempdir()) / "resume-optimizer-lo"
    fonts = base / "user" / "fonts"
    fonts.mkdir(parents=True, exist_ok=True)
    bundled = {f.name for f in FONT_DIR.glob("*.ttf")}
    for stale in fonts.glob("*.ttf"):
        if stale.name not in bundled:
            stale.unlink()
    for f in FONT_DIR.glob("*.ttf"):
        dest = fonts / f.name
        if not dest.exists() or dest.stat().st_size != f.stat().st_size:
            shutil.copyfile(f, dest)
    return base


def _fontconfig(profile: Path) -> Path:
    """Linux: a fontconfig file that adds the bundled fonts to the system ones."""
    conf = profile / "fonts.conf"
    conf.write_text(f"""<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <dir>{FONT_DIR}</dir>
  <cachedir>{profile / "fc-cache"}</cachedir>
</fontconfig>
""", encoding="utf-8")
    return conf


def _run(cmd: list[str], env: dict) -> subprocess.CompletedProcess:
    """Run the converter, killing it if the job is cancelled or it hangs."""
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
    deadline = time.monotonic() + TIMEOUT
    while True:
        try:
            out, err = proc.communicate(timeout=0.5)
            return subprocess.CompletedProcess(cmd, proc.returncode, out, err)
        except subprocess.TimeoutExpired:
            if jobs.cancelled() or time.monotonic() > deadline:
                proc.kill()
                proc.communicate()
                if jobs.cancelled():
                    raise jobs.Cancelled()
                raise PdfError("LibreOffice took too long to make the PDF. Try again, or choose .docx in Settings.")


def _libreoffice(src: Path, pdf: Path) -> None:
    exe = find_soffice()
    profile = _profile()
    env = {**os.environ, "DICPATH": str(HYPHEN_DIR)}   # hyphenation patterns for justified text
    if sys.platform.startswith("linux"):
        env["FONTCONFIG_FILE"] = str(_fontconfig(profile))
    # tagged PDF: explicit reading order and structure for screen readers and ATS parsers
    filt = 'pdf:writer_pdf_Export:{"UseTaggedPDF":{"type":"boolean","value":"true"},' \
           '"EmbedStandardFonts":{"type":"boolean","value":"true"}}'
    with _LO_LOCK, tempfile.TemporaryDirectory() as out_dir:
        res = _run([exe, f"-env:UserInstallation={profile.as_uri()}", "--headless", "--norestore",
                    "--convert-to", filt, "--outdir", out_dir, str(src)], env)
        made = Path(out_dir) / (src.stem + ".pdf")
        if res.returncode != 0 or not made.exists():
            raise PdfError("LibreOffice couldn't convert the file to PDF."
                           + (f" ({(res.stderr or res.stdout).strip()[:200]})" if (res.stderr or res.stdout).strip() else ""))
        shutil.move(str(made), pdf)


# --------------------------------------------------------------------------- Word
def _word(src: Path, pdf: Path) -> None:
    from docx2pdf import convert
    try:
        convert(str(src), str(pdf))
    except Exception as e:  # Word not signed in, sandbox prompt refused, …
        raise PdfError(f"Microsoft Word couldn't make the PDF: {e}")
    if not pdf.exists():
        raise PdfError("Microsoft Word didn't produce a PDF.")


def docx_to_pdf(src: Path, pdf: Path) -> Path:
    """Convert src (.docx) to pdf. Raises PdfError when no converter is available or it fails."""
    how = converter()
    if not how:
        raise PdfError(missing_message())
    pdf.parent.mkdir(parents=True, exist_ok=True)
    (_libreoffice if how == "libreoffice" else _word)(src, pdf)
    return pdf


def page_count(pdf: Path) -> int:
    try:
        import pdfplumber
        with pdfplumber.open(str(pdf)) as doc:
            return len(doc.pages)
    except Exception:
        return 0
