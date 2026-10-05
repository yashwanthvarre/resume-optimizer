import { AnimatePresence, motion } from "motion/react";

/** The numbered circle on a setup card; it pops into a check mark once the step is done. */
export function StepNo({ n, done, id }: { n: number; done: boolean; id?: string }) {
  return (
    <span className={`step-no relative grid size-6 flex-none place-items-center overflow-hidden rounded-full text-xs font-bold transition-colors duration-300 ${
      done ? "bg-sage-bg text-sage" : "bg-sunk text-ink-2"}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        {done
          ? <motion.span key="ok" aria-hidden="true" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 18 }}>✓</motion.span>
          : <motion.span key="n" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>{null}</motion.span>}
      </AnimatePresence>
      {/* the number stays in the DOM (hidden when done) so it's still the step's label */}
      <span id={id} className={done ? "sr-only" : "absolute inset-0 grid place-items-center"}>{n}</span>
    </span>
  );
}
