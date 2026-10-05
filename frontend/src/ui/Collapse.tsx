import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

/** Animates height open/closed; children unmount when closed. */
export function Collapse({ open, children, id, className = "" }: { open: boolean; children: ReactNode; id?: string; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div id={id} className={`overflow-hidden ${className}`} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.26, ease: [0.2, 0.7, 0.2, 1] }}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
