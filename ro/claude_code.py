"""Run Claude through the Claude Code CLI, so the app uses your Claude subscription (Pro/Max)
instead of a paid API key.

One-time setup on each computer:  install Claude Code, run `claude` once and sign in.
"""
from __future__ import annotations

import json
import os
import platform
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

TIMEOUT = 420  # seconds; long resumes can take a couple of minutes


class ClaudeCodeError(RuntimeError):
    pass


def find_claude() -> str | None:
    """Locate the `claude` executable, including common install spots that aren't on PATH
    when the app is started from Finder/Explorer."""
    found = shutil.which("claude")
    if found:
        return found
    home = Path.home()
    candidates = [
        home / ".claude" / "local" / "claude",
        home / ".local" / "bin" / "claude",
        Path("/opt/homebrew/bin/claude"),
        Path("/usr/local/bin/claude"),
        home / ".npm-global" / "bin" / "claude",
    ]
    if platform.system() == "Windows":
        appdata = Path(os.environ.get("APPDATA", home / "AppData" / "Roaming"))
        candidates += [appdata / "npm" / "claude.cmd", home / ".local" / "bin" / "claude.exe"]
    for c in candidates:
        if c.exists():
            return str(c)
    return None


def _extract_json(text: str) -> dict:
    text = (text or "").strip()
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    if m:
        text = m.group(1)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object in response")
    return json.loads(text[start:end + 1])


def _friendly(stderr: str, stdout: str) -> str:
    blob = f"{stderr}\n{stdout}"
    low = blob.lower()
    if "login" in low or "not logged in" in low or "invalid api key" in low or "authenticat" in low:
        return ("Claude Code isn't signed in on this computer. Open Terminal, run `claude`, "
                "sign in with your Claude account, then try again.")
    if "usage limit" in low or "rate limit" in low or "limit reached" in low:
        return "Your Claude plan's usage limit was reached. Try again after it resets."
    last = [l for l in blob.strip().splitlines() if l.strip()]
    return "Claude Code failed: " + (last[-1][:300] if last else "no output")


def _run_cancellable(cmd: list[str], prompt: str, cwd: str, env: dict) -> subprocess.CompletedProcess:
    """subprocess.run, but the child is killed if the user cancels the job it belongs to."""
    from . import jobs
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, encoding="utf-8", cwd=cwd, env=env)
    deadline, pending = time.monotonic() + TIMEOUT, prompt
    while True:
        try:
            out, err = proc.communicate(input=pending, timeout=0.5)
            return subprocess.CompletedProcess(cmd, proc.returncode, out, err)
        except subprocess.TimeoutExpired:
            pending = None  # stdin was already written on the first call
            if jobs.cancelled():
                proc.kill()
                proc.communicate()
                raise jobs.Cancelled()
            if time.monotonic() > deadline:
                proc.kill()
                proc.communicate()
                raise ClaudeCodeError("Claude Code took too long to respond. Please try again.")


def run(system: str, user: str, schema: dict, model: str | None = None) -> dict:
    exe = find_claude()
    if not exe:
        raise ClaudeCodeError("Claude Code isn't installed on this computer. Install it "
                              "(see README), run `claude` once to sign in, then try again.")

    # Make sure the CLI uses the subscription login, not an API key that happens to be set.
    env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
    schema_str = json.dumps(schema)
    json_instr = ("\n\nRespond with ONLY a single JSON object (no prose, no code fences) that "
                  "matches this JSON Schema:\n" + schema_str)

    # Newest CLI first; fall back to fewer flags for older Claude Code versions.
    attempts = [
        (["--no-session-persistence", "--system-prompt", system, "--json-schema", schema_str, "--tools", ""],
         user + json_instr),
        (["--no-session-persistence", "--system-prompt", system, "--tools", ""], user + json_instr),
        ([], system + "\n\n" + user + json_instr),
    ]
    last_err = ""
    with tempfile.TemporaryDirectory(prefix="resume-opt-") as cwd:  # empty dir: no project context
        for flags, prompt in attempts:
            cmd = [exe, "-p", "--output-format", "json", *flags]
            if model:
                cmd += ["--model", model]
            r = _run_cancellable(cmd, prompt, cwd, env)
            err = (r.stderr or "").lower()
            if r.returncode != 0 and ("unknown option" in err or "unknown argument" in err):
                last_err = r.stderr
                continue  # older CLI: retry with fewer flags
            try:
                envelope = json.loads(r.stdout)
            except json.JSONDecodeError:
                raise ClaudeCodeError(_friendly(r.stderr, r.stdout))
            if envelope.get("is_error") or r.returncode != 0:
                raise ClaudeCodeError(_friendly(r.stderr, str(envelope.get("result", ""))))
            if isinstance(envelope.get("structured_output"), dict):
                return envelope["structured_output"]
            try:
                return _extract_json(envelope.get("result", ""))
            except (ValueError, json.JSONDecodeError):
                raise ClaudeCodeError("Claude returned an unreadable answer. Please try again.")
    raise ClaudeCodeError("Your Claude Code version is too old for this app — run `claude update`. "
                          + (last_err.strip().splitlines()[-1][:200] if last_err.strip() else ""))
