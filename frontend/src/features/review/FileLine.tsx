import { useFileNames } from "../../hooks/useFileNames";
import { useApp } from "../../store/app";
import { outFormat } from "../../store/derive";

export function FileLine({ kind }: { kind: "resume" | "cover" }) {
  const n = useFileNames(), cfg = useApp((s) => s.cfg);
  if (!n) return null;
  const f = outFormat(cfg), ext = f === "docx" ? ".docx" : ".pdf";
  return (
    <span className="mt-1 block [overflow-wrap:anywhere]">
      Saves as <b className="font-semibold text-ink">{n[kind] + ext}</b>{f === "both" ? " (and .docx)" : ""}.
      {!n.name_found && " Your name wasn't found on the resume; add it in Settings → “Your name for file names”."}
    </span>
  );
}
