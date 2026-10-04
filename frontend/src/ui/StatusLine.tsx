import { motion } from "motion/react";
import type { Status } from "../store/app";

/** A one-line status under a control: info / ok (✓) / err, with an optional spinner. A new message fades in. */
export function StatusLine({ id, s, className = "" }: { id?: string; s: Status; className?: string }) {
  return (
    <div id={id} className={`status ${s.kind} ${className}`} role={s.kind === "err" ? "alert" : undefined}>
      {s.msg && (
        <motion.span key={s.kind + (s.busy ? "b" : "")} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
          {s.busy && <span className="spinner" aria-hidden="true" />}
          {s.msg}
        </motion.span>
      )}
    </div>
  );
}
