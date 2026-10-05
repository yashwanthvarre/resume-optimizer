import { AnimatePresence, motion } from "motion/react";
import { useToasts } from "../store/toasts";

const ICON = { ok: "✓", err: "!", info: "", "": "" } as const;

export function Toasts() {
  const list = useToasts((s) => s.list);
  return (
    <div className="toasts fixed left-1/2 top-[calc(var(--topbar-h)+12px)] z-50 grid w-max max-w-[calc(100vw-32px)] -translate-x-1/2 justify-items-center gap-2 pointer-events-none"
      aria-live="polite" id="toasts">
      <AnimatePresence initial={false}>
        {list.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, y: -14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }} transition={{ type: "spring", stiffness: 500, damping: 34 }}
            className={`toast ${t.kind} bg-ink px-4 py-2 text-[13.5px] font-medium text-white shadow-2 [overflow-wrap:anywhere] ${
              t.kind === "err" || t.kind === "info" ? "max-w-[min(560px,calc(100vw-32px))] rounded-[14px] text-center" : "rounded-full"}`}>
            {ICON[t.kind] && <b className={`mr-2 ${t.kind === "ok" ? "text-[#9fd8b1]" : "text-[#f3c969]"}`}>{ICON[t.kind]}</b>}
            {t.msg}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
