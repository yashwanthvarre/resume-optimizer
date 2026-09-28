"""OS-independent path handling and native file pickers."""
from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

SUPPORTED = {".docx", ".pdf", ".txt", ".md"}


class PathError(ValueError):
    pass


def resolve_user_path(raw: str, must_exist: bool = True, want_dir: bool = False) -> Path:
    """Turn whatever the user typed/pasted into an absolute Path on *this* machine.

    Handles: surrounding quotes (Windows "Copy as path", macOS option-copy),
    ~ / ~user, $VARS and %VARS%, file:// URLs, relative paths, and mixed slashes.
    """
    s = (raw or "").strip().strip('"').strip("'").strip()
    if not s:
        raise PathError("Please enter a path.")
    if s.lower().startswith("file://"):
        s = unquote(urlparse(s).path)
        if platform.system() == "Windows" and s.startswith("/") and len(s) > 2 and s[2] == ":":
            s = s[1:]  # /C:/Users/... -> C:/Users/...
    s = os.path.expandvars(os.path.expanduser(s))
    # A shell-escaped path copied from a macOS/Linux terminal ("My\ Resume.docx")
    if os.sep == "/" and "\\ " in s:
        s = s.replace("\\ ", " ")
    p = Path(s)
    if not p.is_absolute():
        p = Path.cwd() / p
    p = p.resolve()
    if must_exist and not p.exists():
        raise PathError(f"Nothing found at: {p}")
    if must_exist and want_dir and not p.is_dir():
        raise PathError(f"Not a folder: {p}")
    if must_exist and not want_dir:
        if p.is_dir():
            raise PathError(f"That is a folder, not a file: {p}")
        if p.suffix.lower() not in SUPPORTED:
            raise PathError(f"Unsupported file type '{p.suffix}'. Use .docx, .pdf or .txt.")
    return p


_TK_SCRIPT = r"""
import sys, tkinter as tk
from tkinter import filedialog
root = tk.Tk(); root.withdraw()
try: root.attributes('-topmost', True)
except Exception: pass
if sys.argv[1] == 'folder':
    r = filedialog.askdirectory(title='Choose output folder')
else:
    r = filedialog.askopenfilename(title='Select your resume',
        filetypes=[('Resumes', '*.docx *.pdf *.txt *.md'), ('All files', '*.*')])
print(r or '')
"""


def pick_native(kind: str = "file") -> str:
    """Open the OS's own file/folder dialog and return the chosen path ('' if cancelled).

    Runs in a subprocess so GUI toolkits never touch the web server's threads.
    """
    system = platform.system()
    try:
        if system == "Darwin":
            what = "choose folder with prompt \"Choose output folder\"" if kind == "folder" \
                else "choose file with prompt \"Select your resume\""
            r = subprocess.run(["osascript", "-e", f"POSIX path of ({what})"],
                               capture_output=True, text=True, timeout=300)
            return r.stdout.strip() if r.returncode == 0 else ""
        if system == "Linux" and shutil.which("zenity"):
            args = ["zenity", "--file-selection"] + (["--directory"] if kind == "folder" else [])
            r = subprocess.run(args, capture_output=True, text=True, timeout=300)
            return r.stdout.strip() if r.returncode == 0 else ""
        r = subprocess.run([sys.executable, "-c", _TK_SCRIPT, kind],
                           capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            raise RuntimeError(r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "dialog failed")
        return r.stdout.strip()
    except (FileNotFoundError, RuntimeError, subprocess.TimeoutExpired) as e:
        raise PathError(f"Couldn't open a file dialog on this system ({e}). "
                        "Type the path or use Upload instead.") from e
