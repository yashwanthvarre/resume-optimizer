"""Background jobs with live progress events.

Long operations (JD fetch, analysis, cover letter, export) run in a thread. Code anywhere in
the call stack reports what it is doing with `emit(step, status, message)`; the browser
follows along over Server-Sent Events. Outside a job, `emit` and `check` are no-ops, so the
same functions still work when called directly (tests, the synchronous endpoints).
"""
from __future__ import annotations

import secrets
import threading
import time
from typing import Any, Callable

MAX_JOBS = 50
_local = threading.local()
JOBS: dict[str, "Job"] = {}
_jobs_lock = threading.Lock()


class Cancelled(Exception):
    pass


class Job:
    def __init__(self, kind: str, title: str, plan: list[tuple[str, str]]):
        self.id = secrets.token_urlsafe(8)
        self.kind, self.title = kind, title
        self.plan = [{"step": k, "label": label} for k, label in plan]
        self.events: list[dict] = []
        self.status = "running"          # running | done | error | cancelled
        self.result: Any = None
        self.error = ""
        self.started = time.time()
        self.cancel_requested = threading.Event()
        self._cond = threading.Condition()

    # -- producer side
    def emit(self, step: str, status: str, message: str, detail: Any = None, pct: float | None = None) -> None:
        with self._cond:
            ev = {"seq": len(self.events), "step": step, "status": status, "message": message, "ts": time.time()}
            if detail is not None:
                ev["detail"] = detail
            if pct is not None:
                ev["pct"] = pct
            self.events.append(ev)
            self._cond.notify_all()

    def finish(self, status: str, result: Any = None, error: str = "") -> None:
        with self._cond:
            self.status, self.result, self.error = status, result, error
            self._cond.notify_all()

    # -- consumer side
    def wait(self, since: int, timeout: float) -> tuple[list[dict], bool]:
        """Events after `since`, blocking up to `timeout` seconds for something new."""
        with self._cond:
            if len(self.events) <= since and self.status == "running":
                self._cond.wait(timeout)
            return self.events[since:], self.status != "running"

    def snapshot(self, since: int = 0) -> dict:
        with self._cond:
            out = {"job_id": self.id, "kind": self.kind, "title": self.title, "plan": self.plan,
                   "status": self.status, "started": self.started, "events": self.events[since:]}
            if self.status == "done":
                out["result"] = self.result
            if self.error:
                out["error"] = self.error
            return out

    def end_payload(self) -> dict:
        return {"status": self.status, "result": self.result if self.status == "done" else None,
                "error": self.error}


def start(kind: str, title: str, plan: list[tuple[str, str]], fn: Callable[[], Any]) -> Job:
    job = Job(kind, title, plan)
    with _jobs_lock:
        JOBS[job.id] = job
        for old in list(JOBS)[:-MAX_JOBS]:
            JOBS.pop(old, None)

    def run():
        _local.job = job
        try:
            job.finish("done", result=fn())
        except Cancelled:
            _mark_running(job, "error", "Cancelled")
            job.finish("cancelled", error="Cancelled by you.")
        except Exception as e:  # noqa: BLE001 — surface every failure in the UI
            msg = getattr(e, "detail", None) or str(e) or e.__class__.__name__  # HTTPException keeps its text in .detail
            _mark_running(job, "error", msg)
            job.finish("error", error=msg)
        finally:
            _local.job = None

    threading.Thread(target=run, name=f"job-{kind}", daemon=True).start()
    return job


def _mark_running(job: Job, status: str, message: str) -> None:
    """Close out the steps left in progress, so the error shows on the step that failed.

    The most recent running step gets the message; any other still-running step is marked
    stopped. If nothing was running (failed between steps), the next planned step gets it.
    """
    last: dict[str, str] = {}
    for ev in job.events:
        last[ev["step"]] = ev["status"]
    running = [s for s, st in last.items() if st == "running"]
    for s in running[:-1]:
        job.emit(s, status, "Stopped")
    if running:
        target = running[-1]
    else:
        pending = [p["step"] for p in job.plan if p["step"] not in last]
        target = pending[0] if pending else (job.plan[-1]["step"] if job.plan else "job")
    job.emit(target, status, message)


def get(job_id: str) -> Job | None:
    return JOBS.get(job_id)


def current() -> Job | None:
    return getattr(_local, "job", None)


def emit(step: str, status: str, message: str, detail: Any = None, pct: float | None = None) -> None:
    job = current()
    if job:
        job.emit(step, status, message, detail, pct)


def cancelled() -> bool:
    job = current()
    return bool(job and job.cancel_requested.is_set())


def check() -> None:
    """Checkpoint: stop here if the user pressed Cancel."""
    if cancelled():
        raise Cancelled()
