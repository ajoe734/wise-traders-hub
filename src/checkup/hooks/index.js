/**
 * Hooks exports
 * Centralized exports for all custom React hooks
 */

export { usePortfolioManagement } from './usePortfolioManagement.js'
export { useAppConfirmationDialog } from './useAppConfirmationDialog.js'
export { useMarketData } from './useMarketData.js'
export { useEvents } from './useEvents.js'
// C-A (holdings audit 2026-05): useHoldings (local-state) 已刪除 — orphan, 從未被消費。
// 持倉狀態請改用 useHoldingsStore（Zustand）或 useMyTradeRecordHoldings（React Query）。
export { useReports } from './useReports.js'
export { usePortfolioDerivedData } from './usePortfolioDerivedData.js'
export { usePortfolioBootstrap } from './usePortfolioBootstrap.js'
export { usePortfolioPersistence } from './usePortfolioPersistence.js'
export { useTradeCaptureRuntime } from './useTradeCaptureRuntime.js'
export { useWeeklyReportClipboard } from './useWeeklyReportClipboard.js'
export { usePortfolioDossierActions } from './usePortfolioDossierActions.js'
export { useWatchlistActions } from './useWatchlistActions.js'
export { useTransientUiActions } from './useTransientUiActions.js'
export { useSavedToast } from './useSavedToast.js'
export { useAppShellUiState } from './useAppShellUiState.js'
export { useCanonicalLocalhostRedirect } from './useCanonicalLocalhostRedirect.js'
export { useAppRuntimeSyncRefs } from './useAppRuntimeSyncRefs.js'
export { useAppCallbackRefs } from './useAppCallbackRefs.js'
export {
  useAppBootRuntimeComposer,
  useAppLifecycleRuntimeComposer,
  usePortfolioManagementComposer,
} from './useAppRuntimeComposer.js'
export { useAppRuntimeCoreLifecycle } from './useAppRuntimeCoreLifecycle.js'
export { useAppRuntimeCoreArgs, useAppRuntimeWorkflowArgs } from './useAppRuntimeArgs.js'
export { useAppRuntimePortfolioDerivedData } from './useAppRuntimePortfolioDerivedData.js'
export { useAppRuntimeHeaderProps } from './useAppRuntimeHeaderProps.js'
export { usePortfolioPanelsContextComposer } from './usePortfolioPanelsContextComposer.js'
export { usePortfolioSnapshotRuntime } from './usePortfolioSnapshotRuntime.js'
export { useDailyAnalysisWorkflow } from './useDailyAnalysisWorkflow.js'
export { useResearchWorkflow } from './useResearchWorkflow.js'
export { useStressTestWorkflow } from './useStressTestWorkflow.js'
export { useEventReviewWorkflow } from './useEventReviewWorkflow.js'
export { useEventLifecycleSync } from './useEventLifecycleSync.js'
export { useReportRefreshWorkflow } from './useReportRefreshWorkflow.js'
export { useLocalBackupWorkflow } from './useLocalBackupWorkflow.js'
export { useAppRuntime } from './useAppRuntime.js'
export { useRoutePortfolioRuntime } from './useRoutePortfolioRuntime.js'
export { useRouteHoldingsPage } from './useRouteHoldingsPage.js'

export { useRouteEventsPage } from './useRouteEventsPage.js'
export { useRouteNewsPage } from './useRouteNewsPage.js'
export { useRouteDailyPage } from './useRouteDailyPage.js'
export { useRouteResearchPage } from './useRouteResearchPage.js'
export { useRouteTradePage } from './useRouteTradePage.js'
export { useRouteLogPage } from './useRouteLogPage.js'
export { useRouteOverviewPage } from './useRouteOverviewPage.js'
