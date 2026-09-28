"""Resume Optimizer — run with:  python app.py   (opens http://127.0.0.1:8765)"""
from __future__ import annotations

import argparse
import os
import secrets
import socket
import threading
import webbrowser
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ro import analyzer, claude_code, config, jd_fetch, paths, resume_io

config.ensure_dirs()
config.load_env()

app = FastAPI(title="Resume Optimizer")
SESSIONS: dict[str, dict] = {}   # in-memory; one per loaded resume
DOWNLOADS: dict[str, Path] = {}


def _err(status: int, msg: str):
    raise HTTPException(status_code=status, detail=msg)


def _session(sid: str) -> dict:
    s = SESSIONS.get(sid)
    if not s:
        _err(404, "Resume session expired — load the resume again.")
    return s


def _open_resume(path: Path, uploaded: bool = False) -> dict:
    try:
        parsed = resume_io.parse_resume(path)
    except ValueError as e:
        _err(400, str(e))
    sid = secrets.token_urlsafe(8)
    SESSIONS[sid] = {"path": path, "uploaded": uploaded, **parsed}
    if not uploaded:
        config.save_config(last_resume_path=str(path))
    paras = parsed["paragraphs"]
    return {"session_id": sid, "file_name": path.name, "path": str(path),
            "source_type": parsed["source_type"], "paragraphs": paras,
            "default_output_dir": str(config.load_config().get("output_dir")
                                      or (Path.home() / "Documents" if uploaded else path.parent)),
            "keeps_formatting": parsed["source_type"] == "docx",
            "count": sum(1 for p in paras if p["text"].strip())}


# ------------------------------------------------------------------ models
class PathIn(BaseModel):
    path: str


class PickIn(BaseModel):
    kind: str = "file"


class SettingsIn(BaseModel):
    api_key: Optional[str] = None
    model: Optional[str] = None
    engine: Optional[str] = None
    cc_model: Optional[str] = None


class UrlIn(BaseModel):
    url: str


class AnalyzeIn(BaseModel):
    session_id: str
    jd_text: str


class Edit(BaseModel):
    target_id: str
    new_text: str


class ExportIn(BaseModel):
    session_id: str
    accepted: list[Edit]
    output_dir: Optional[str] = None
    company: str = ""
    role: str = ""


# ------------------------------------------------------------------ routes
@app.get("/api/config")
def get_config():
    cfg = config.load_config()
    cc_path = claude_code.find_claude()
    return {"last_resume_path": cfg.get("last_resume_path", ""), "output_dir": cfg.get("output_dir", ""),
            "has_api_key": config.has_api_key(), "model": config.get_model(),
            "engine": config.get_engine_pref(), "active_engine": config.active_engine(),
            "claude_code_path": cc_path or "", "cc_model": config.get_cc_model(),
            "playwright": jd_fetch.playwright_available(), "home": str(Path.home()), "os": os.name}


@app.post("/api/settings")
def save_settings(body: SettingsIn):
    if body.api_key and body.api_key.strip():
        config.save_api_key(body.api_key)
    if body.model and body.model.strip():
        config.save_config(model=body.model.strip())
    if body.engine in config.ENGINES:
        config.save_config(engine=body.engine)
    if body.cc_model is not None:
        config.save_config(cc_model=body.cc_model.strip())
    return get_config()


@app.post("/api/pick")
def pick(body: PickIn):
    try:
        return {"path": paths.pick_native(body.kind)}
    except paths.PathError as e:
        _err(400, str(e))


@app.post("/api/resume/load")
def load_resume(body: PathIn):
    try:
        p = paths.resolve_user_path(body.path)
    except paths.PathError as e:
        _err(400, str(e))
    return _open_resume(p)


@app.post("/api/resume/upload")
async def upload_resume(file: UploadFile = File(...)):
    name = Path(file.filename or "resume").name
    if Path(name).suffix.lower() not in paths.SUPPORTED:
        _err(400, "Upload a .docx, .pdf or .txt file.")
    dest = config.UPLOAD_DIR / f"{secrets.token_hex(3)}_{name}"
    dest.write_bytes(await file.read())
    return _open_resume(dest, uploaded=True)


@app.post("/api/jd/fetch")
def fetch_jd(body: UrlIn):
    try:
        return jd_fetch.fetch_jd(body.url)
    except jd_fetch.FetchError as e:
        _err(422, str(e))


@app.post("/api/analyze")
def analyze(body: AnalyzeIn):
    s = _session(body.session_id)
    if len(body.jd_text.strip()) < 100:
        _err(400, "The job description looks too short. Paste the full JD text.")
    try:
        jd = analyzer.analyze_jd(body.jd_text)
        raw = analyzer.propose_changes(jd, s["paragraphs"])
    except analyzer.AIError as e:
        _err(502, str(e))
    result = analyzer.validate_changes(raw, s["paragraphs"])
    s["jd"] = jd
    return {"jd": jd, **result}


@app.post("/api/export")
def export(body: ExportIn):
    s = _session(body.session_id)
    if body.output_dir and body.output_dir.strip():
        try:
            out_dir = paths.resolve_user_path(body.output_dir, must_exist=False)
            out_dir.mkdir(parents=True, exist_ok=True)
        except (paths.PathError, OSError) as e:
            _err(400, f"Can't use that output folder: {e}")
        config.save_config(output_dir=str(out_dir))
    else:
        out_dir = Path.home() / "Documents" if s["uploaded"] else s["path"].parent
        out_dir.mkdir(parents=True, exist_ok=True)
    edits = {e.target_id: e.new_text for e in body.accepted}
    dest = resume_io.output_path(out_dir, body.company, body.role)
    try:
        resume_io.export_docx(s["path"], s["source_type"], s["paragraphs"], edits, dest)
    except PermissionError:
        _err(400, f"Can't write to {out_dir}. Choose another output folder.")
    token = secrets.token_urlsafe(10)
    DOWNLOADS[token] = dest
    return {"path": str(dest), "file_name": dest.name, "download_url": f"/api/download/{token}",
            "applied": len(edits)}


@app.get("/api/download/{token}")
def download(token: str):
    p = DOWNLOADS.get(token)
    if not p or not p.exists():
        _err(404, "File not found.")
    return FileResponse(p, filename=p.name,
                        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")


app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="static")


def _free_port(start: int) -> int:
    for port in range(start, start + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return start


if __name__ == "__main__":
    import uvicorn
    ap = argparse.ArgumentParser(description="Resume Optimizer")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    port = _free_port(args.port)
    url = f"http://127.0.0.1:{port}"
    print(f"\n  Resume Optimizer running at {url}\n  Press Ctrl+C to stop.\n")
    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
