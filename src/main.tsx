import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { DedupSettingsButton } from "./checkup/components/DedupSettingsButton";
import { runWhenIdle } from "./lib/idleSchedule";

// Render first — these two installers are non-critical for first paint
// (validation toasts + stale-bundle detection). Defer to idle so they
// don't compete with React mount on slow devices.
runWhenIdle(() => {
  void import("./checkup/lib/edgeFetchInterceptor.js").then((m) =>
    m.installEdgeFetchInterceptor()
  );
  void import("./lib/versionCheck").then((m) => m.installVersionCheck());
}, 3000);

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
    <DedupSettingsButton />
  </HelmetProvider>
);

