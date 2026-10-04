import type { Config, Edit, FileNames } from "./types";

/** JSON (or FormData) request to the backend; a non-2xx response throws with the server's `detail`. */
export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method: body !== undefined ? "POST" : "GET" };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { detail?: string }).detail || `Request failed (${r.status})`);
  return data as T;
}

export const getConfig = () => api<Config>("/api/config");
export const saveSettings = (body: Record<string, unknown>) => api<Config>("/api/settings", body);
export const getFileNames = (session_id: string, accepted: Edit[]) =>
  api<FileNames>("/api/file_names", { session_id, accepted });
export const pickPath = (kind: "file" | "folder") => api<{ path: string }>("/api/pick", { kind });
