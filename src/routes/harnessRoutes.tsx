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
 * A runtime environment check is a configuration boundary, not a security
 * boundary. These routes are therefore excluded at BUILD time: the caller
 * guards on `import.meta.env.DEV`, Vite replaces that with the literal
 * `false` for `vite build`, and Rollup drops this whole module plus every
 * `import()` below — the harness chunks are never emitted, so a production
 * bundle scan finds no route, no component and no chunk.
 *
 * Consequence for tests: harness specs only run against the dev server
 * (which is what `playwright.config.ts` targets). Anything that must hold on
 * a production build has to be asserted through the product routes with
 * network interception.
 */
import { lazy } from "react";
import { Route } from "react-router-dom";

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

/** Top-level `/e2e/*` harness routes. Dev builds only. */
export const harnessRoutes = () => [
  <Route key="e2e-holding-card" path="/e2e/holding-card-harness" element={<HoldingCardHarnessEntry />} />,
  <Route key="e2e-range-band" path="/e2e/range-band-harness" element={<RangeBandHarnessEntry />} />,
  <Route key="e2e-holdings-table-target" path="/e2e/holdings-table-target-harness" element={<HoldingsTableTargetHarnessEntry />} />,
  <Route key="e2e-holdings-detail-volume" path="/e2e/holdings-detail-panel-volume" element={<HoldingsDetailPanelVolumeHarnessEntry />} />,
  <Route key="e2e-signal-editor" path="/e2e/signal-editor-harness" element={<SignalEditorHarnessEntry />} />,
  <Route key="e2e-etf-display" path="/e2e/etf-display-harness" element={<EtfDisplayHarnessEntry />} />,
  <Route key="e2e-signal-preview" path="/e2e/signal-preview-harness" element={<SignalPreviewHarnessEntry />} />,
  <Route key="e2e-signal-focus" path="/e2e/signal-focus-harness" element={<SignalFocusHarnessEntry />} />,
  <Route key="e2e-journal-pdf" path="/e2e/journal-pdf-harness" element={<JournalPdfHarnessEntry />} />,
  <Route key="e2e-notification-link" path="/e2e/notification-link-harness" element={<NotificationLinkHarnessEntry />} />,
  <Route key="e2e-early-publish-copy" path="/e2e/early-publish-copy-harness" element={<EarlyPublishCopyHarnessEntry />} />,
  <Route key="e2e-journals-export" path="/e2e/journals-export-harness" element={<JournalsExportHarnessEntry />} />,
  <Route key="e2e-journals-export-ui" path="/e2e/journals-export-ui-harness" element={<JournalsExportUIHarnessEntry />} />,
  <Route key="e2e-journals-export-header" path="/e2e/journals-export-header-dom" element={<JournalsExportHeaderDomHarnessEntry />} />,
  <Route key="e2e-chips-section" path="/e2e/chips-section" element={<ChipsSectionHarnessEntry />} />,
  <Route key="e2e-chips-batch" path="/e2e/chips-batch" element={<ChipsBatchHarnessEntry />} />,
  <Route key="e2e-journal-authoring" path="/e2e/journal-authoring-harness" element={<JournalAuthoringHarnessEntry />} />,
];

/** Nested harness route under the portfolio shell. Dev builds only. */
export const portfolioHarnessRoutes = () => [
  <Route key="shell-bus" path="__shell-bus" element={<ShellEventBusHarnessEntry />} />,
];
