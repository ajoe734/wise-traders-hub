/**
 * Playwright component-harness routes (`/e2e/*` and
 * `/portfolio/:portfolioId/__shell-bus`).
 *
 * R1-P backdoor closure. These pages mount real product components with
 * fabricated props supplied from the URL, which means they can render
 * holding / signal / chips economic UI without going through the public
 * projection contract. Previously each harness component defended itself with
 * a hostname check at runtime, so the code still shipped in the production
 * bundle and the only thing standing between an anonymous visitor and a
 * component that renders economic numbers was a string comparison.
 *
 * Gate model: every route and lazy import is always present in the route table.
 * Authorization happens inside `HarnessRouteGuard` when React enters the route,
 * using the browser's runtime hostname. This avoids both Rollup tree-shaking and
 * module-top-level pre-evaluation in production-like unpublished Preview builds.
 *
 * The gate is now a RUNTIME check with a closed allow-list
 * (`src/routes/harnessHostGate.ts`): local dev/localhost, or a hostname that
 * exactly matches `preview--<slug>.lovable.app`. Custom domains
 * (legendflow.tw / www.legendflow.tw), published production and any lookalike
 * host stay 404. The query string never grants access, and every harness page
 * renders fake-gateway fixtures only — no real user data, no live DB/Edge call.
 *
 * The guard wraps every lazy element, so denied hosts render the same NotFound
 * page without evaluating the lazy harness component. Every harness itself still
 * uses fake gateway / fake fixtures only.
 */
import { lazy, type ReactNode } from "react";
import { Route } from "react-router-dom";
import NotFound from "../pages/NotFound";
import { isHarnessHostAllowed } from "./harnessHostGate";

const HoldingCardHarnessEntry = lazy(() => import("../pages/HoldingCardHarnessEntry"));
const RangeBandHarnessEntry = lazy(() => import("../pages/RangeBandHarnessEntry"));
const HoldingsTableTargetHarnessEntry = lazy(() => import("../pages/HoldingsTableTargetHarnessEntry"));
const HoldingsDetailPanelVolumeHarnessEntry = lazy(() => import("../pages/HoldingsDetailPanelVolumeHarnessEntry"));
const SignalEditorHarnessEntry = lazy(() => import("../pages/SignalEditorHarnessEntry"));
const EtfDisplayHarnessEntry = lazy(() => import("../pages/EtfDisplayHarnessEntry"));
const SignalPreviewHarnessEntry = lazy(() => import("../pages/SignalPreviewHarnessEntry"));
const SignalFocusHarnessEntry = lazy(() => import("../pages/SignalFocusHarnessEntry"));
const JournalPdfHarnessEntry = lazy(() => import("../pages/JournalPdfHarnessEntry"));
const NotificationLinkHarnessEntry = lazy(() => import("../pages/NotificationLinkHarnessEntry"));
const EarlyPublishCopyHarnessEntry = lazy(() => import("../pages/EarlyPublishCopyHarnessEntry"));
const JournalsExportHarnessEntry = lazy(() => import("../pages/JournalsExportHarnessEntry"));
const JournalsExportUIHarnessEntry = lazy(() => import("../pages/JournalsExportUIHarnessEntry"));
const JournalsExportHeaderDomHarnessEntry = lazy(() => import("../pages/JournalsExportHeaderDomHarnessEntry"));
const ChipsSectionHarnessEntry = lazy(() => import("../pages/ChipsSectionHarnessEntry"));
const ChipsBatchHarnessEntry = lazy(() => import("../pages/ChipsBatchHarnessEntry"));
const JournalAuthoringHarnessEntry = lazy(() => import("../pages/JournalAuthoringHarnessEntry"));
const ShellEventBusHarnessEntry = lazy(() => import("../pages/ShellEventBusHarnessEntry"));

interface HarnessRouteGuardProps {
  children: ReactNode;
  /** Explicit only for executable contracts; production routes omit this. */
  hostname?: string;
}

export function HarnessRouteGuard({ children, hostname }: HarnessRouteGuardProps) {
  const runtimeHostname = hostname ?? (typeof window === "undefined" ? "" : window.location.hostname);
  return isHarnessHostAllowed(runtimeHostname) ? <>{children}</> : <NotFound />;
}

const guarded = (element: ReactNode) => <HarnessRouteGuard>{element}</HarnessRouteGuard>;

/** Top-level `/e2e/*` harness routes. Always registered; runtime-host guarded. */
export const harnessRoutes = () => [
  <Route key="e2e-holding-card" path="/e2e/holding-card-harness" element={guarded(<HoldingCardHarnessEntry />)} />,
  <Route key="e2e-range-band" path="/e2e/range-band-harness" element={guarded(<RangeBandHarnessEntry />)} />,
  <Route key="e2e-holdings-table-target" path="/e2e/holdings-table-target-harness" element={guarded(<HoldingsTableTargetHarnessEntry />)} />,
  <Route key="e2e-holdings-detail-volume" path="/e2e/holdings-detail-panel-volume" element={guarded(<HoldingsDetailPanelVolumeHarnessEntry />)} />,
  <Route key="e2e-signal-editor" path="/e2e/signal-editor-harness" element={guarded(<SignalEditorHarnessEntry />)} />,
  <Route key="e2e-etf-display" path="/e2e/etf-display-harness" element={guarded(<EtfDisplayHarnessEntry />)} />,
  <Route key="e2e-signal-preview" path="/e2e/signal-preview-harness" element={guarded(<SignalPreviewHarnessEntry />)} />,
  <Route key="e2e-signal-focus" path="/e2e/signal-focus-harness" element={guarded(<SignalFocusHarnessEntry />)} />,
  <Route key="e2e-journal-pdf" path="/e2e/journal-pdf-harness" element={guarded(<JournalPdfHarnessEntry />)} />,
  <Route key="e2e-notification-link" path="/e2e/notification-link-harness" element={guarded(<NotificationLinkHarnessEntry />)} />,
  <Route key="e2e-early-publish-copy" path="/e2e/early-publish-copy-harness" element={guarded(<EarlyPublishCopyHarnessEntry />)} />,
  <Route key="e2e-journals-export" path="/e2e/journals-export-harness" element={guarded(<JournalsExportHarnessEntry />)} />,
  <Route key="e2e-journals-export-ui" path="/e2e/journals-export-ui-harness" element={guarded(<JournalsExportUIHarnessEntry />)} />,
  <Route key="e2e-journals-export-header" path="/e2e/journals-export-header-dom" element={guarded(<JournalsExportHeaderDomHarnessEntry />)} />,
  <Route key="e2e-chips-section" path="/e2e/chips-section" element={guarded(<ChipsSectionHarnessEntry />)} />,
  <Route key="e2e-chips-batch" path="/e2e/chips-batch" element={guarded(<ChipsBatchHarnessEntry />)} />,
  <Route key="e2e-journal-authoring" path="/e2e/journal-authoring-harness" element={guarded(<JournalAuthoringHarnessEntry />)} />,
];

/** Nested harness route. Always registered; runtime-host guarded. */
export const portfolioHarnessRoutes = () => [
  <Route key="shell-bus" path="__shell-bus" element={guarded(<ShellEventBusHarnessEntry />)} />,
];
