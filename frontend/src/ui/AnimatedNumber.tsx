import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

/** A number that counts to its new value. */
export function AnimatedNumber({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null), prev = useRef(value), reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce || prev.current === value) { el.textContent = String(value); prev.current = value; return; }
    const c = animate(prev.current, value, { duration: 0.5, ease: "easeOut", onUpdate: (v) => { el.textContent = String(Math.round(v)); } });
    prev.current = value;
    return () => c.stop();
  }, [value, reduce]);
  return <span ref={ref}>{value}</span>;
}
