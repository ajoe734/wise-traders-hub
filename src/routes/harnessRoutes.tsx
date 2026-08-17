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

// Literal at build time: `vite build` substitutes `false`, so every `lazy()`
// below collapses to `null` and Rollup never emits the harness chunks. A
// module-level const (rather than a check inside the route factory) is what
// makes the dynamic imports statically unreachable — with the check further
// down, the chunks were still emitted and listed in the preload manifest.
const DEV = import.meta.env.DEV;

const HoldingCardHarnessEntry = DEV ? lazy(() => import("../pages/HoldingCardHarnessEntry")) : (() => null);
const RangeBandHarnessEntry = DEV ? lazy(() => import("../pages/RangeBandHarnessEntry")) : (() => null);
const HoldingsTableTargetHarnessEntry = DEV ? lazy(() => import("../pages/HoldingsTableTargetHarnessEntry")) : (() => null);
const HoldingsDetailPanelVolumeHarnessEntry = DEV ? lazy(() => import("../pages/HoldingsDetailPanelVolumeHarnessEntry")) : (() => null);
const SignalEditorHarnessEntry = DEV ? lazy(() => import("../pages/SignalEditorHarnessEntry")) : (() => null);
const EtfDisplayHarnessEntry = DEV ? lazy(() => import("../pages/EtfDisplayHarnessEntry")) : (() => null);
const SignalPreviewHarnessEntry = DEV ? lazy(() => import("../pages/SignalPreviewHarnessEntry")) : (() => null);
const SignalFocusHarnessEntry = DEV ? lazy(() => import("../pages/SignalFocusHarnessEntry")) : (() => null);
const JournalPdfHarnessEntry = DEV ? lazy(() => import("../pages/JournalPdfHarnessEntry")) : (() => null);
const NotificationLinkHarnessEntry = DEV ? lazy(() => import("../pages/NotificationLinkHarnessEntry")) : (() => null);
const EarlyPublishCopyHarnessEntry = DEV ? lazy(() => import("../pages/EarlyPublishCopyHarnessEntry")) : (() => null);
const JournalsExportHarnessEntry = DEV ? lazy(() => import("../pages/JournalsExportHarnessEntry")) : (() => null);
const JournalsExportUIHarnessEntry = DEV ? lazy(() => import("../pages/JournalsExportUIHarnessEntry")) : (() => null);
const JournalsExportHeaderDomHarnessEntry = DEV ? lazy(() => import("../pages/JournalsExportHeaderDomHarnessEntry")) : (() => null);
const ChipsSectionHarnessEntry = DEV ? lazy(() => import("../pages/ChipsSectionHarnessEntry")) : (() => null);
const ChipsBatchHarnessEntry = DEV ? lazy(() => import("../pages/ChipsBatchHarnessEntry")) : (() => null);
const JournalAuthoringHarnessEntry = DEV ? lazy(() => import("../pages/JournalAuthoringHarnessEntry")) : (() => null);
const ShellEventBusHarnessEntry = DEV ? lazy(() => import("../pages/ShellEventBusHarnessEntry")) : (() => null);

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
