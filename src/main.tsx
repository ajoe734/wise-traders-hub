import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { DedupSettingsButton } from "./checkup/components/DedupSettingsButton";
import { installEdgeFetchInterceptor } from "./checkup/lib/edgeFetchInterceptor.js";
import { runWhenIdle } from "./lib/idleSchedule";
import { installVersionCheck } from "./lib/versionCheck";

// Render first — these two installers are non-critical for first paint
// (validation toasts + stale-bundle detection). Defer to idle so they
// don't compete with React mount on slow devices.
runWhenIdle(() => {
  try {
    installEdgeFetchInterceptor();
    installVersionCheck();
  } catch {
    // best-effort only — app should still render if helpers fail
  }
}, 3000);

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
    <DedupSettingsButton />
  </HelmetProvider>
);

