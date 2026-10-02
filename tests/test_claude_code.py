"""Tests for the Claude Code engine using fake `claude` executables."""
import os, sys, stat, json, tempfile
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ro import claude_code

def fake(script):
    d = tempfile.mkdtemp(); p = Path(d) / "claude"
    p.write_text("#!/usr/bin/env python3\nimport sys, json\nargs = sys.argv[1:]\nprompt = sys.stdin.read()\n" + script)
    p.chmod(p.stat().st_mode | stat.S_IEXEC); return str(p)

SCHEMA = {"type": "object", "properties": {"a": {"type": "integer"}}}
cases = {
  "structured": ('print(json.dumps({"type":"result","is_error":False,"result":"","structured_output":{"a":1}}))', {"a": 1}),
  "fenced":     ('print(json.dumps({"type":"result","is_error":False,"result":"Here:\\n```json\\n{\\"a\\": 2}\\n```"}))', {"a": 2}),
  "old_cli":    ('if "--json-schema" in args:\n    sys.stderr.write("error: unknown option \'--json-schema\'\\n"); sys.exit(1)\n'
                 'assert "--tools" in args\nprint(json.dumps({"is_error":False,"result":"{\\"a\\": 3}"}))', {"a": 3}),
  "no_api_key_leak": ('import os\nassert "ANTHROPIC_API_KEY" not in os.environ\nprint(json.dumps({"is_error":False,"result":"{\\"a\\": 4}"}))', {"a": 4}),
}
os.environ["ANTHROPIC_API_KEY"] = "sk-should-not-leak"
for name, (script, want) in cases.items():
    with mock.patch.object(claude_code, "find_claude", lambda s=script: fake(s)):
        got = claude_code.run("sys", "user", SCHEMA)
        assert got == want, (name, got); print("ok:", name)
# tools are off by default; a call can opt into named built-in tools, which are then pre-approved
TOOLS = ('i = args.index("--tools")\nprint(json.dumps({"is_error":False,"structured_output":'
         '{"tools": args[i + 1], "allowed": args[args.index("--allowedTools") + 1] if "--allowedTools" in args else None}}))')
with mock.patch.object(claude_code, "find_claude", lambda: fake(TOOLS)):
    assert claude_code.run("s", "u", SCHEMA) == {"tools": "", "allowed": None}
    assert claude_code.run("s", "u", SCHEMA, tools=("WebSearch",)) == {"tools": "WebSearch", "allowed": "WebSearch"}
    print("ok: tools off by default, WebSearch on request")
with mock.patch.object(claude_code, "find_claude", lambda: fake('print(json.dumps({"is_error":True,"result":"Invalid API key · Please run /login"}))')):
    try: claude_code.run("s", "u", SCHEMA); raise SystemExit("expected error")
    except claude_code.ClaudeCodeError as e: assert "signed in" in str(e); print("ok: login message ->", e)
with mock.patch.object(claude_code, "find_claude", lambda: None):
    try: claude_code.run("s", "u", SCHEMA)
    except claude_code.ClaudeCodeError as e: print("ok: not installed ->", str(e)[:60])
print("OK")
