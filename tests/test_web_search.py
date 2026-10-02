"""Only the keyword step may search the web, in both engines; the API loop resumes paused turns and nudges once."""
import os, sys, tempfile
from pathlib import Path
from types import SimpleNamespace as NS
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["HOME"] = os.environ["USERPROFILE"] = tempfile.mkdtemp()
from ro import analyzer, claude_code, config

# ---- Claude Code engine: WebSearch for record_keyword_decisions only
seen = []
with mock.patch.object(config, "active_engine", lambda: "claude_code"), \
     mock.patch.object(claude_code, "run", lambda s, u, schema, model=None, tools=(): seen.append(tools) or {"ok": 1}):
    analyzer._call_tool("s", "u", analyzer.KEYWORDS_TOOL, 100)
    for t in (analyzer.JD_TOOL, analyzer.CHANGES_TOOL, analyzer.COVER_TOOL):
        analyzer._call_tool("s", "u", t, 100)
assert seen == [("WebSearch",), (), (), ()], seen
print("ok: Claude Code gets WebSearch for keywords only")

# ---- API engine
text = lambda t: NS(type="text", text=t)
search = NS(type="server_tool_use", name="web_search")
record = NS(type="tool_use", name="record_keyword_decisions", input={"decisions": [], "changes": []})
class Fake:
    def __init__(self, replies): self.replies, self.requests = list(replies), []
    def create(self, **kw):
        self.requests.append({**kw, "messages": list(kw["messages"])}); return self.replies.pop(0)

def run(replies, model="claude-sonnet-5", tool=analyzer.KEYWORDS_TOOL):
    f = Fake(replies)
    with mock.patch.object(config, "active_engine", lambda: "api"), mock.patch.object(config, "get_model", lambda: model), \
         mock.patch.object(analyzer, "_client", lambda: NS(messages=f)):
        try: return analyzer._call_tool("s", "u", tool, 6000), f.requests
        except analyzer.AIError as e: return e, f.requests

out, reqs = run([NS(stop_reason="pause_turn", content=[search]), NS(stop_reason="tool_use", content=[text("x"), record])])
assert out == record.input and len(reqs) == 2
first = reqs[0]
assert [t.get("type", t.get("name")) for t in first["tools"]] == ["web_search_20260209", "record_keyword_decisions"]
assert first["tools"][0]["max_uses"] == analyzer.WEB_MAX_USES and first["tool_choice"] == {"type": "auto"}
assert reqs[1]["messages"][-1] == {"role": "assistant", "content": [search]}   # resumed, no "continue" message
print("ok: pause_turn resumed")

out, reqs = run([NS(stop_reason="end_turn", content=[text("done")]), NS(stop_reason="tool_use", content=[record])])
assert out == record.input and "Now call record_keyword_decisions" in reqs[1]["messages"][-1]["content"]
out, reqs = run([NS(stop_reason="end_turn", content=[text("a")]), NS(stop_reason="end_turn", content=[text("b")])])
assert isinstance(out, analyzer.AIError) and len(reqs) == 2
print("ok: nudged once, then a clear error")

_, reqs = run([NS(stop_reason="tool_use", content=[record])], model="claude-haiku-4-5")
assert reqs[0]["tools"][0]["type"] == "web_search_20250305"                      # older models: basic search
jd = NS(type="tool_use", name="record_jd", input={"role": "x"})
out, reqs = run([NS(stop_reason="tool_use", content=[jd])], tool=analyzer.JD_TOOL)
assert out == {"role": "x"} and [t["name"] for t in reqs[0]["tools"]] == ["record_jd"]
assert reqs[0]["tool_choice"] == {"type": "tool", "name": "record_jd"}
print("ok: search version by model; other calls unchanged")
print("OK")
