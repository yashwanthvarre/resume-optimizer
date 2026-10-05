import { motion } from "motion/react";
import { useId } from "react";

export interface SegOption<T extends string> {
  value: T;
  label: string;
  title?: string;
}

/** Segmented control; the active pill slides to the chosen option. */
export function Seg<T extends string>({ id, options, value, onChange, label, labelledBy, radio, className = "" }: {
  id?: string; options: SegOption<T>[]; value: T; onChange: (v: T) => void;
  label?: string; labelledBy?: string; radio?: boolean; className?: string;
}) {
  const layoutId = useId();
  return (
    <div id={id} className={`seg ${className}`} role={radio ? "radiogroup" : "group"} aria-label={label} aria-labelledby={labelledBy}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" data-v={o.value} title={o.title} className={on ? "active" : ""}
            {...(radio ? { role: "radio", "aria-checked": on } : { "aria-pressed": on })}
            onClick={() => onChange(o.value)}>
            {on && <motion.span layoutId={layoutId} className="seg-pill" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
