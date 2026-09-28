"""Run the app with canned AI responses — for UI development without an API key.
Usage: python tests/mock_server.py [port]"""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("ANTHROPIC_API_KEY", "mock")
import uvicorn, app as appmod
from ro import analyzer
sys.path.insert(0, str(Path(__file__).parent))
from test_e2e_data import JD, CH
analyzer._call_tool = lambda s, u, tool, mt: JD if tool["name"] == "record_jd" else CH
uvicorn.run(appmod.app, host="127.0.0.1", port=int(sys.argv[1]) if len(sys.argv) > 1 else 8799, log_level="warning")
