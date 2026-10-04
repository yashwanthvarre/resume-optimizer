import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { pickPath, saveSettings } from "../../api/client";
import { errMsg } from "../../lib/jobs";
import { set, useApp } from "../../store/app";
import { toast } from "../../store/toasts";

type Engine = "claude_code" | "api";

export function SettingsDialog() {
  const { settingsOpen, cfg, resume } = useApp();
  const qc = useQueryClient();
  const [f, setF] = useState({ engine: "claude_code" as Engine, apiKey: "", model: "", ccModel: "", outDir: "", fileFormat: "pdf", nameOverride: "", docFont: "EB Garamond", boldKw: true });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  // fill the form from the saved settings each time it opens
  useEffect(() => {
    if (!settingsOpen || !cfg) return;
    setErr("");
    setF({
      engine: (cfg.engine === "auto" ? cfg.active_engine : cfg.engine) as Engine, apiKey: "", model: cfg.model || "", ccModel: cfg.cc_model ?? "sonnet",
      outDir: cfg.output_dir || "", fileFormat: cfg.file_format || "pdf", nameOverride: cfg.name_override || "",
      docFont: cfg.doc_font || "EB Garamond", boldKw: cfg.bold_keywords !== false,
    });
  }, [settingsOpen, cfg]);

  const close = () => set({ settingsOpen: false });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const next = await saveSettings({ engine: f.engine, api_key: f.apiKey, model: f.model, cc_model: f.ccModel, output_dir: f.outDir,
        doc_font: f.docFont, bold_keywords: f.boldKw, file_format: f.fileFormat, name_override: f.nameOverride });
      set({ cfg: next, settingsOpen: false });
      void qc.invalidateQueries({ queryKey: ["fileNames"] });
      toast("Settings saved", "ok");
    } catch (x) { setErr(errMsg(x)); }
    finally { setSaving(false); }
  };
  const browse = async () => {
    try { const { path } = await pickPath("folder"); if (path) setF((v) => ({ ...v, outDir: path })); }
    catch (x) { setErr(errMsg(x)); }
  };
  const radio = "my-2 flex cursor-pointer items-start gap-2 text-sm [&_input]:mt-1 [&_input]:accent-accent";

  return (
    <Dialog.Root open={settingsOpen} onOpenChange={(o) => set({ settingsOpen: o })}>
      <AnimatePresence>
        {settingsOpen && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-[rgba(31,35,40,.25)] backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div id="settingsDlg" className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-32px)] w-[min(480px,calc(100vw-32px))] overflow-auto rounded-2xl border border-line bg-paper text-ink shadow-2"
                initial={{ opacity: 0, scale: 0.95, x: "-50%", y: "-46%" }} animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
                exit={{ opacity: 0, scale: 0.96, x: "-50%", y: "-48%", transition: { duration: 0.15 } }} transition={{ type: "spring", stiffness: 420, damping: 34 }}>
                <form className="grid p-6" onSubmit={save}>
                  <Dialog.Title className="mb-1 text-xl font-[650]">Settings</Dialog.Title>
                  <div className="label">How the app talks to Claude</div>
                  <label className={radio}><input type="radio" name="engine" value="claude_code" checked={f.engine === "claude_code"} onChange={() => setF({ ...f, engine: "claude_code" })} />
                    <span><b>My Claude subscription</b> (via Claude Code). No API key; uses your plan.</span></label>
                  <div className={`hint ${cfg?.claude_code_path ? "ok" : "err"}`} id="ccState">
                    {cfg?.claude_code_path ? "Claude Code found on this computer. If it isn't signed in yet, run `claude` in Terminal once and sign in."
                      : "Claude Code not found. Install it (see README), run `claude` once to sign in, then restart this app."}
                  </div>
                  <label className={radio}><input type="radio" name="engine" value="api" checked={f.engine === "api"} onChange={() => setF({ ...f, engine: "api" })} />
                    <span><b>Anthropic API key</b>, pay-as-you-go</span></label>
                  <AnimatePresence mode="wait" initial={false}>
                    {f.engine === "api" ? (
                      <motion.div key="api" id="apiFields" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        <label className="label" htmlFor="apiKey">API key</label>
                        <input id="apiKey" className="field" type="password" placeholder="sk-ant-…" autoComplete="off" value={f.apiKey} onChange={(e) => setF({ ...f, apiKey: e.target.value })} />
                        <div className="hint" id="keyState">{cfg?.has_api_key ? "A key is saved. Leave blank to keep it." : "Get one at platform.claude.com → API keys (billed separately from Claude plans)."}</div>
                        <label className="label" htmlFor="modelIn">API model</label>
                        <input id="modelIn" className="field" type="text" spellCheck={false} value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
                      </motion.div>
                    ) : (
                      <motion.div key="cc" id="ccFields" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        <label className="label" htmlFor="ccModelIn">Claude Code model</label>
                        <input id="ccModelIn" className="field" type="text" spellCheck={false} placeholder="sonnet" value={f.ccModel} onChange={(e) => setF({ ...f, ccModel: e.target.value })} />
                        <div className="hint">An alias like <code>sonnet</code> or <code>opus</code>, or leave blank for Claude Code's default.</div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <label className="label" htmlFor="outDir">Save downloads to</label>
                  <div className="flex items-center gap-2">
                    <input id="outDir" className="field" type="text" spellCheck={false} placeholder={resume ? resume.default_output_dir : "Next to your resume"}
                      value={f.outDir} onChange={(e) => setF({ ...f, outDir: e.target.value })} />
                    <button type="button" className="btn secondary" id="outBrowse" onClick={() => void browse()}>Browse…</button>
                  </div>
                  <div className="hint">A copy of each file you download is also saved here.</div>

                  <label className="label" htmlFor="fileFormat">File format</label>
                  <select id="fileFormat" className="field" value={f.fileFormat} onChange={(e) => setF({ ...f, fileFormat: e.target.value })}>
                    <option value="pdf">PDF</option><option value="docx">Word (.docx)</option><option value="both">Both (PDF + .docx)</option>
                  </select>
                  <div className={`hint ${cfg?.pdf_converter ? "ok" : "err"}`} id="pdfState">
                    {cfg?.pdf_converter ? `PDFs are made with ${cfg.pdf_converter === "word" ? "Microsoft Word" : "LibreOffice"}, with EB Garamond embedded.`
                      : `${cfg?.pdf_missing} Until one is installed, downloads are saved as .docx.`}
                  </div>

                  <label className="label" htmlFor="nameOverride">Your name for file names</label>
                  <input id="nameOverride" className="field" type="text" spellCheck={false} autoComplete="name" placeholder="Taken from your resume"
                    value={f.nameOverride} onChange={(e) => setF({ ...f, nameOverride: e.target.value })} />
                  <div className="hint">Files are named like <code>First_Last_Company_Role_Resume.pdf</code> and <code>First_Last_Company_Role_Cover_Letter.pdf</code>. Leave this blank to use the name at the top of your resume.</div>

                  <label className="label" htmlFor="docFont">Document font</label>
                  <select id="docFont" className="field" value={f.docFont} onChange={(e) => setF({ ...f, docFont: e.target.value })}>
                    <option value="EB Garamond">EB Garamond</option><option value="keep">Keep my resume's font</option>
                  </select>
                  <div className="hint">Used for the resume and cover letter. PDFs embed it, so they look the same everywhere. A .docx shows EB Garamond only where it's installed (<a href="https://fonts.google.com/specimen/EB+Garamond" target="_blank" rel="noopener">free download</a>).</div>

                  <label className={radio}><input type="checkbox" id="boldKw" checked={f.boldKw} onChange={(e) => setF({ ...f, boldKw: e.target.checked })} />
                    <span><b>Bold keywords in resume</b>. The job's keywords are set in bold, with no other highlighting.</span></label>

                  <details className="mt-4 text-[13.5px]">
                    <summary className="cursor-pointer font-semibold">Keyboard shortcuts</summary>
                    <table className="mt-2 border-collapse [&_td]:py-[5px] [&_td]:pr-3 [&_td:first-child]:whitespace-nowrap">
                      <tbody>
                        <tr><td><kbd>j</kbd> / <kbd>k</kbd></td><td>Next / previous edit</td></tr>
                        <tr><td><kbd>Space</kbd> or <kbd>x</kbd></td><td>Accept / skip the open edit</td></tr>
                        <tr><td><kbd>e</kbd></td><td>Edit it</td></tr>
                        <tr><td><kbd>a</kbd> / <kbd>n</kbd></td><td>Accept all / skip all</td></tr>
                        <tr><td><kbd>h</kbd></td><td>Show or hide changes on the page</td></tr>
                        <tr><td><kbd>Esc</kbd></td><td>Close the popover or clear a filter</td></tr>
                      </tbody>
                    </table>
                  </details>
                  <div className="hint">Settings are saved on this computer in <code>~/.resume-optimizer</code>.</div>
                  {err && <div className="status err" role="alert">{err}</div>}
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" className="btn ghost" onClick={close}>Cancel</button>
                    <button type="submit" className="btn" id="saveSettings" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
                  </div>
                </form>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
