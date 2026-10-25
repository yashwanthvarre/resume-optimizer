import { set, useApp } from "../../store/app";
import { dlChoice } from "../../store/derive";
import { Seg } from "../../ui/Seg";

/** PDF / DOCX next to a Download button. Starts at the Settings choice; the pick holds for the session. */
export function FormatToggle({ id }: { id: string }) {
  const cfg = useApp((s) => s.cfg), dlFormat = useApp((s) => s.dlFormat), exporting = useApp((s) => s.exporting);
  const noPdf = !cfg?.pdf_converter;
  return (
    <Seg id={id} label="Download format" radio value={noPdf ? "docx" : dlChoice({ cfg, dlFormat })} onChange={(v) => !exporting && set({ dlFormat: v })}
      options={[
        { value: "pdf", label: "PDF", disabled: noPdf, title: noPdf ? cfg?.pdf_missing : "Download a PDF" },
        { value: "docx", label: "DOCX", title: "Download a Word document" },
      ]} />
  );
}
