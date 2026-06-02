import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { DedupSettingsButton } from "./checkup/components/DedupSettingsButton";
import { installEdgeFetchInterceptor } from "./checkup/lib/edgeFetchInterceptor.js";
import { runWhenIdle } from "./lib/idleSchedule";
import { installVersionCheck } from "./lib/versionCheck";
import { bootstrapRuntimeDiagnostics } from "./checkup/lib/runtimeLogger.js";

// Render first — these installers are non-critical for first paint
// (validation toasts + stale-bundle detection + remote diagnostics sinks).
// Defer to idle so they don't compete with React mount on slow devices.
// bootstrapRuntimeDiagnostics wires window error / unhandledrejection /
// web-vitals into the same pipeline ErrorBoundary uses
// (captureClientDiagnostic → analytics + Sentry sinks when enabled via
// VITE_RUNTIME_ANALYTICS_ENABLED / VITE_RUNTIME_SENTRY_ENABLED or
// window.__PORTFOLIO_RUNTIME_MONITORING__). In test/SSR there is no
// window so the call short-circuits; sinks are no-ops when disabled.
runWhenIdle(() => {
  try {
    installEdgeFetchInterceptor();
    installVersionCheck();
    bootstrapRuntimeDiagnostics();
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

