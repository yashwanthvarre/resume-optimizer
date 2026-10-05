// Long operations run as server jobs. Their progress events arrive over Server-Sent Events (falling back to
// polling) and show in the Activity pill, its panel, and the inline progress UIs.
import { create } from "zustand";
import { api } from "../api/client";
import type { Job, JobEvent, JobStatus, StepStatus } from "../api/types";

export const now = () => Date.now() / 1000;

interface ActivityState {
  jobs: Job[];
  live: string; // latest running message, for the screen-reader live region
  open: boolean;
}
export const useActivity = create<ActivityState>(() => ({ jobs: [], live: "", open: false }));

// jobs are mutated in place as events arrive; this publishes a new array so subscribers re-render
const publish = (live?: string) =>
  useActivity.setState((s) => ({ jobs: [...s.jobs], ...(live !== undefined ? { live } : {}) }));

function track(job: Job) {
  useActivity.setState((s) => ({ jobs: [job, ...s.jobs].slice(0, 30) }));
}

export interface StepView {
  step: string;
  label: string;
  status: StepStatus;
  message?: string;
  detail?: unknown;
  log: string[];
  t0?: number;
  t1?: number | null;
}

export function jobProgress(job: Job) {
  const steps: StepView[] = job.plan.map((p) => ({ step: p.step, label: p.label, status: "pending", log: [] }));
  const by: Record<string, StepView> = Object.fromEntries(steps.map((x) => [x.step, x]));
  for (const ev of job.events) {
    let st = by[ev.step];
    if (!st) {
      st = by[ev.step] = { step: ev.step, label: ev.step, status: "pending", log: [] };
      steps.push(st);
    }
    if (st.t0 == null) st.t0 = ev.ts;
    st.status = ev.status;
    st.message = ev.message;
    st.log.push(ev.message);
    if (ev.detail != null) st.detail = ev.detail;
    st.t1 = ev.status === "running" ? null : ev.ts;
  }
  const n = steps.length || 1;
  const done = steps.filter((x) => x.status === "done").length;
  const ri = steps.findIndex((x) => x.status === "running");
  return { steps, n, done, cur: ri >= 0 ? ri : Math.min(done, n - 1), current: ri >= 0 ? steps[ri] : null };
}

export class JobError extends Error {
  cancelled: boolean;
  constructor(message: string, cancelled = false) {
    super(message);
    this.cancelled = cancelled;
  }
}
export const isCancelled = (e: unknown) => e instanceof JobError && e.cancelled;
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface EndPayload {
  status: JobStatus;
  result?: unknown;
  error?: string;
}

/** Start a server job and resolve with its result. `onEvent` runs on every progress event. */
export async function runJob<T>(path: string, body: unknown, onEvent?: (job: Job) => void): Promise<T> {
  const info = await api<Pick<Job, "job_id" | "title" | "plan">>(path, body); // bad input fails here, before a job exists
  const job: Job = { ...info, events: [], status: "running", t0: now(), seen: -1 };
  track(job);
  const changed = (live?: string) => {
    onEvent?.(job);
    publish(live);
  };
  changed();
  return new Promise<T>((resolve, reject) => {
    let ended = false, fails = 0;
    const push = (ev: JobEvent) => {
      if (ev.seq <= job.seen) return; // replayed after a reconnect
      job.seen = ev.seq;
      job.events.push(ev);
      changed(ev.status === "running" ? ev.message : undefined);
    };
    const finish = (end: EndPayload) => {
      if (ended) return;
      ended = true;
      job.status = end.status;
      job.error = end.error || "";
      job.t1 = now();
      changed();
      if (end.status === "done") return resolve(end.result as T);
      reject(new JobError(end.error || "Something went wrong.", end.status === "cancelled"));
    };
    const poll = async () => {
      if (ended) return;
      try {
        const snap = await api<EndPayload & { events: JobEvent[] }>(`/api/jobs/${job.job_id}?since=${job.seen + 1}`);
        fails = 0;
        snap.events.forEach(push);
        if (snap.status !== "running") return finish(snap);
      } catch (e) {
        if (++fails >= 4) return finish({ status: "error", error: errMsg(e) });
      }
      setTimeout(poll, 700);
    };
    if (!window.EventSource) return void poll();
    const es = new EventSource(`/api/jobs/${job.job_id}/events`);
    es.onmessage = (m) => push(JSON.parse(m.data));
    es.addEventListener("end", (m) => {
      es.close();
      finish(JSON.parse((m as MessageEvent).data));
    });
    es.onerror = () => {
      es.close();
      void poll(); // stream dropped: carry on by polling
    };
  });
}

export function cancelJob(job: Job | null | undefined) {
  if (job && job.status === "running" && !job.local) api(`/api/jobs/${job.job_id}/cancel`, {}).catch(() => {});
}

/** Record a step list that ran in the browser (e.g. loading the resume) in the Activity panel. */
export function logLocal(
  title: string,
  steps: { step: string; label: string; message: string; detail?: unknown; status?: StepStatus }[],
  status: JobStatus = "done",
  error = "",
) {
  const t = now();
  track({
    job_id: "local-" + Math.random().toString(36).slice(2),
    title, local: true, status, error, t0: t, t1: t, seen: steps.length - 1,
    plan: steps.map((x) => ({ step: x.step, label: x.label })),
    events: steps.map((x, i) => ({ seq: i, step: x.step, status: x.status || (status === "done" ? "done" : "error"), message: x.message, detail: x.detail, ts: t })),
  });
}

export function fmtDur(sec: number) {
  sec = Math.max(0, sec);
  return sec < 60 ? `${sec.toFixed(sec < 10 ? 1 : 0)}s` : `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}
