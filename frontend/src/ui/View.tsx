import { motion } from "motion/react";
import type { ReactNode } from "react";

/** One of the three screens. Kept mounted (so fields keep their state) and faded in when it becomes current. */
export function View({ id, visible, className, children }: { id: string; visible: boolean; className: string; children: ReactNode }) {
  return (
    <motion.main id={id} hidden={!visible} className={className}
      initial={false} animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
      transition={{ duration: 0.32, ease: [0.2, 0.7, 0.2, 1] }}>
      {children}
    </motion.main>
  );
}
