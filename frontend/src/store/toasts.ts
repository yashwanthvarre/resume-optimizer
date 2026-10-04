import { create } from "zustand";

export type ToastKind = "" | "ok" | "err" | "info";
export interface Toast {
  id: number;
  msg: string;
  kind: ToastKind;
}

export const useToasts = create<{ list: Toast[] }>(() => ({ list: [] }));
let nextId = 1;

export function toast(msg: string, kind: ToastKind = "") {
  const id = nextId++;
  useToasts.setState((s) => ({ list: [...s.list, { id, msg, kind }] }));
  setTimeout(() => useToasts.setState((s) => ({ list: s.list.filter((t) => t.id !== id) })), kind === "err" || kind === "info" ? 7000 : 3000);
}
