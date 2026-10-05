import { useLayoutEffect, useRef } from "react";

/** Grows a textarea to fit its content. */
export function useAutosize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }, [value]);
  return ref;
}
