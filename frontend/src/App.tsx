import { MotionConfig } from "motion/react";
import { useEffect } from "react";
import { ActivityPanel } from "./features/activity/ActivityPanel";
import { CoverView } from "./features/coverLetter/CoverView";
import { GapsPanel } from "./features/keywords/GapsPanel";
import { KeywordsPanel } from "./features/keywords/KeywordsPanel";
import { EditPopover } from "./features/review/EditPopover";
import { ReviewView } from "./features/review/ReviewView";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import { init } from "./features/setup/actions";
import { SetupView } from "./features/setup/SetupView";
import { TopBar } from "./features/topbar/TopBar";
import { useApp } from "./store/app";
import { Toasts } from "./ui/Toasts";

let started = false;

export function App() {
  const docFont = useApp((s) => s.cfg?.doc_font);
  useEffect(() => {
    if (started) return; // StrictMode runs effects twice in development
    started = true;
    init().catch((e) => {
      console.error(e);
      document.body.insertAdjacentHTML("afterbegin",
        `<div role="alert" style="padding:12px 20px;background:#fbe9ec;color:#a23b4e;font:600 14px system-ui">Couldn't reach the Resume Optimizer server: ${String(e.message || e).replace(/</g, "&lt;")}</div>`);
    });
  }, []);
  // the page previews exactly what the download will use
  useEffect(() => { document.body.classList.toggle("keep-font", docFont === "keep"); }, [docFont]);

  return (
    <MotionConfig reducedMotion="user">
      <TopBar />
      <SetupView />
      <ReviewView />
      <CoverView />
      <EditPopover />
      <ActivityPanel />
      <KeywordsPanel />
      <GapsPanel />
      <SettingsDialog />
      <Toasts />
    </MotionConfig>
  );
}
