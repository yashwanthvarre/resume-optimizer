import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

/** A non-modal side panel that slides in from the right (the Activity pill and the page stay usable behind it). */
export function Sheet({ id, open, onClose, title, sub, wide, children, foot, top, labelId }: {
  id: string; open: boolean; onClose: () => void; title: string; sub?: ReactNode; wide?: boolean;
  children: ReactNode; foot?: ReactNode; top?: ReactNode; labelId: string;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) closeRef.current?.focus({ preventScroll: true }); }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <motion.aside id={id} role="dialog" aria-labelledby={labelId} className={`sheet ${wide ? "wide" : ""}`}
          initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 38 }}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); onClose(); } }}>
          <div className="sheet-head">
            <div><h3 id={labelId} className="mb-0.5">{title}</h3>{sub && <div className="muted small">{sub}</div>}</div>
            <button ref={closeRef} type="button" className="btn ghost icon" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>✕</button>
          </div>
          {top}
          <div className="sheet-body">{children}</div>
          {foot && <div className="sheet-foot">{foot}</div>}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
