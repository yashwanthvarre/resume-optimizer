import { useEffect, useState } from "react";
import { now } from "../lib/jobs";

/** Seconds since the epoch, refreshed every `ms` while `active`. */
export function useNow(active = true, ms = 500) {
  const [t, setT] = useState(now);
  useEffect(() => {
    if (!active) return;
    const h = setInterval(() => setT(now()), ms);
    return () => clearInterval(h);
  }, [active, ms]);
  return active ? t : now();
}
