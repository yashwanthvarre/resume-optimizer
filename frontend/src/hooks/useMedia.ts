import { useSyncExternalStore } from "react";

export function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(query); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia(query).matches,
  );
}
export const SHEET_QUERY = "(pointer: coarse), (max-width: 620px)";
