import { useState, useRef } from 'react'
import { useHoldingsStore } from '../stores/holdingsStore.js'
import { useEventStore } from '../stores/eventStore.js'
import { useBrainStore } from '../stores/brainStore.js'
import { useReportsStore } from '../stores/reportsStore.js'
import { C } from '../theme.js'
import { IND_COLOR, NEWS_EVENTS, RELAY_PLAN_CODES, STOCK_META } from '../seedData.js'
import { useAppConfirmationDialog } from './useAppConfirmationDialog.js'
import { useSavedToast } from './useSavedToast.js'
import { useAppShellUiState } from './useAppShellUiState.js'
import { useCanonicalLocalhostRedirect } from './useCanonicalLocalhostRedirect.js'
import {
  pickPnlTone,
  // @deprecated 對應 legacy AppShellFrame，未在 runtime 使用。詳見 docs/architecture/holdings-modules.md
  composeAppShellFrameRuntime,
  composeAppRuntimeWorkflowInput,
  composeAppRuntimeHeaderInput,
} from './useAppRuntimeComposer.js'
import { useThesisTracking } from './useThesisTracking.js'
import { useAppRuntimeWorkflows } from './useAppRuntimeWorkflows.js'
import { usePostCloseSilentSync } from './usePostCloseSilentSync.js'
import { useMorningNoteRuntime } from './useMorningNoteRuntime.js'
import { useAppRuntimeCoreLifecycle } from './useAppRuntimeCoreLifecycle.js'
import { useAppRuntimeCoreArgs, useAppRuntimeWorkflowArgs } from './useAppRuntimeArgs.js'
import { useAppRuntimePortfolioDerivedData } from './useAppRuntimePortfolioDerivedData.js'
import { useAppRuntimeHeaderProps } from './useAppRuntimeHeaderProps.js'
import {
  APP_RUNTIME_CORE_LIFECYCLE_HELPERS,
  APP_RUNTIME_WORKFLOW_HELPERS,
} from './useAppRuntimeHelperCatalog.js'
import {
  OWNER_PORTFOLIO_ID,
  PORTFOLIO_VIEW_MODE,
  OVERVIEW_VIEW_MODE,
  POST_CLOSE_SYNC_MINUTES,
} from '../constants.js'
import {
  normalizeHoldingDossiers,
} from '../lib/brainRuntime.js'
import {
  getHoldingCostBasis,
  getHoldingMarketValue,
  getHoldingUnrealizedPnl,
  getHoldingReturnPct,
  applyMarketQuotesToHoldings,
} from '../lib/holdings.js'
import {
  formatDateToStorageDate,
  getTaipeiClock,
  parseStoredDate,
  todayStorageDate,
} from '../lib/datetime.js'
import { buildHoldingDossiers } from '../lib/dossierUtils.js'
import {
  getEventStockCodes,
  isClosedEvent,
  normalizeNewsEvents,
  parseFlexibleDate,
} from '../lib/eventUtils.js'
import {
  clonePortfolioNotes,
  getPortfolioFallback,
  pfKey,
  readStorageValue,
} from '../lib/portfolioUtils.js'
import { APP_ERROR_BOUNDARY_COPY, APP_LOADING_MESSAGE } from '../lib/appMessages.js'

const PORTFOLIO_DERIVED_HELPERS = {
  normalizeHoldingDossiers,
  buildHoldingDossiers,
  getHoldingMarketValue,
  getHoldingCostBasis,
  getHoldingUnrealizedPnl,
  getHoldingReturnPct,
  applyMarketQuotesToHoldings,
  clonePortfolioNotes,
  normalizeNewsEvents,
  getEventStockCodes,
  isClosedEvent,
  parseFlexibleDate,
  todayStorageDate,
  formatDateToStorageDate,
  getTaipeiClock,
  parseStoredDate,
  readStorageValue,
  pfKey,
  getPortfolioFallback,
}

const PORTFOLIO_DERIVED_CONSTANTS = {
  OWNER_PORTFOLIO_ID,
  PORTFOLIO_VIEW_MODE,
  OVERVIEW_VIEW_MODE,
  POST_CLOSE_SYNC_MINUTES,
  RELAY_PLAN_CODES,
  STOCK_META,
  C,
}

const pickHeaderPnlTone = (value) => pickPnlTone(value, C)

export function useAppRuntime() {
  const [ready, setReady] = useState(false)

  // Holdings slice — backed by useHoldingsStore (3A.2 migration).
  // Phase 3A.4 Step 3: store-backed setters no longer prop-drilled from this
  // composer. Hooks downstream import the store directly. Only state values
  // are subscribed here so React re-renders propagate as before.
  const holdings = useHoldingsStore((s) => s.holdings)
  const tradeLog = useHoldingsStore((s) => s.tradeLog)
  const targets = useHoldingsStore((s) => s.targets)
  const fundamentals = useHoldingsStore((s) => s.fundamentals)
  const watchlist = useHoldingsStore((s) => s.watchlist)
  const analystReports = useHoldingsStore((s) => s.analystReports)
  const reportRefreshMeta = useHoldingsStore((s) => s.reportRefreshMeta)
  const holdingDossiers = useHoldingsStore((s) => s.holdingDossiers)

  const { saved, flashSaved } = useSavedToast()

  // Reports / research / async flags — backed by useReportsStore (3A.3 migration).
  const analyzing = useReportsStore((s) => s.analyzing)
  const setAnalyzing = useReportsStore((s) => s.setAnalyzing)
  const analyzeStep = useReportsStore((s) => s.analyzeStep)
  const setAnalyzeStep = useReportsStore((s) => s.setAnalyzeStep)
  const dailyReport = useReportsStore((s) => s.dailyReport)
  const analysisHistory = useReportsStore((s) => s.analysisHistory)
  const researching = useReportsStore((s) => s.researching)
  const setResearching = useReportsStore((s) => s.setResearching)
  const researchHistory = useReportsStore((s) => s.researchHistory)

  // Events — backed by useEventStore.
  const newsEvents = useEventStore((s) => s.newsEvents)

  // Reversal conditions still live in holdingsStore (3A.2).
  const reversalConditions = useHoldingsStore((s) => s.reversalConditions)

  // Strategy brain — backed by useBrainStore.
  const strategyBrain = useBrainStore((s) => s.strategyBrain)
  const brainValidation = useBrainStore((s) => s.brainValidation)

  // Runtime-only UI state (deferred to 3A.4).
  const [portfolioNotes, setPortfolioNotes] = useState(() => clonePortfolioNotes())
  const [cloudSync, setCloudSync] = useState(false)

  const cloudSaveTimersRef = useRef({})
  const cloudSyncStateRef = useRef({ enabled: false, syncedAt: 0 })
  const portfolioSetterRef = useRef({
    setActivePortfolioId: () => {},
    setViewMode: () => {},
  })
  const portfoliosRef = useRef([])
  const activePortfolioIdRef = useRef(OWNER_PORTFOLIO_ID)
  const viewModeRef = useRef(PORTFOLIO_VIEW_MODE)
  const bootRuntimeRef = useRef(null)
  const refreshAnalystReportsRef = useRef(async () => false)
  const resetTradeCaptureRef = useRef(() => {})

  useCanonicalLocalhostRedirect()

  const appUiState = useAppShellUiState({
    resetTradeCaptureRef,
  })

  const {
    tab,
    setTab,
    sortBy,
    setReviewingEvent,
    setReviewForm,
    resetTransientUiState,
  } = appUiState

  const { appConfirmDialog, requestAppConfirmation, closeAppConfirmDialog } =
    useAppConfirmationDialog()

  const runtimeState = {
    ready,
    holdings,
    watchlist,
    newsEvents,
    tradeLog,
    targets,
    fundamentals,
    analystReports,
    reportRefreshMeta,
    holdingDossiers,
    analysisHistory,
    dailyReport,
    reversalConditions,
    strategyBrain,
    brainValidation,
    researchHistory,
    portfolioNotes,
  }

  // Phase 3A.4 Step 3: store-backed setters 已從各 hook 內部直接走 store
  // (useHoldingsStore / useEventStore / useReportsStore / useBrainStore)，
  // 不再透過 runtimeSetters 物件 prop drill。此處只保留 UI / cloud state setter。
  const runtimeSetters = {
    setReady,
    setCloudSync,
    setPortfolioNotes,
  }

  const coreLifecycleArgs = useAppRuntimeCoreArgs({
    state: runtimeState,
    setters: runtimeSetters,
    ui: {
      tab,
      resetTransientUiState,
      setReviewingEvent,
      setReviewForm,
    },
    runtime: {
      flashSaved,
      requestAppConfirmation,
    },
    refs: {
      activePortfolioIdRef,
      viewModeRef,
      portfoliosRef,
      portfolioSetterRef,
      bootRuntimeRef,
      cloudSyncStateRef,
      cloudSaveTimersRef,
    },
    helpers: APP_RUNTIME_CORE_LIFECYCLE_HELPERS,
  })

  const {
    marketPriceCache,
    marketPriceSync,
    lastUpdate,
    setLastUpdate,
    refreshing,
    priceSyncStatusLabel,
    priceSyncStatusTone,
    activePriceSyncAt,
    refreshPrices,
    syncPostClosePrices,
    getMarketQuotesForCodes,
    priceSelfHealRef,
    applyPortfolioSnapshot,
    livePortfolioSnapshot,
    portfolios,
    setPortfolios,
    activePortfolioId,
    setActivePortfolioId,
    viewMode,
    setViewMode,
    portfolioSwitching,
    showPortfolioManager,
    setShowPortfolioManager,
    portfolioTransitionRef,
    portfolioSummaries,
    createPortfolio,
    renamePortfolio,
    deletePortfolio,
    portfolioEditor,
    portfolioDeleteDialog,
    switchPortfolio,
    openOverview,
    exitOverview,
    canUseCloud,
    updateTargetPrice,
    updateAlert,
    upsertTargetReport,
    upsertFundamentalsEntry,
    handleWatchlistUpsert,
    handleWatchlistDelete,
    updateReversal,
    cancelReview,
  } = useAppRuntimeCoreLifecycle(coreLifecycleArgs)

  const { theses } = useThesisTracking(activePortfolioId)
  const morningNote = useMorningNoteRuntime({ holdings, theses, newsEvents, watchlist })

  usePostCloseSilentSync({
    ready,
    viewMode,
    portfolioViewMode: PORTFOLIO_VIEW_MODE,
    activePortfolioId,
    syncPostClosePrices,
  })

  const {
    H,
    W,
    dossierByCode,
    totalVal,
    totalCost,
    totalPnl,
    retPct,
    todayMarketClock,
    holdingsIntegrityIssues,
    shouldTriggerPostCloseSelfHeal,
    overviewPortfolios,
    overviewTotalValue,
    overviewTotalPnl,
    displayedTotalPnl,
    displayedRetPct,
    overviewDuplicateHoldings,
    overviewPendingItems,
    urgentCount,
    todayAlertSummary,
    watchlistRows,
    watchlistFocus,
    showRelayPlan,
    top5,
    winners,
    losers,
    attentionCount,
    pendingCount,
    targetUpdateCount,
    dataRefreshRows,
    todayRefreshKey,
    reportRefreshCandidates,
  } = useAppRuntimePortfolioDerivedData({
    data: {
      holdings,
      watchlist,
      sortBy,
      holdingDossiers,
      targets,
      fundamentals,
      analystReports,
      newsEvents,
      researchHistory,
      strategyBrain,
      marketPriceCache,
      marketPriceSync,
      activePortfolioId,
      portfolioSummaries,
      viewMode,
      portfolioNotes,
      reportRefreshMeta,
    },
    helperFns: PORTFOLIO_DERIVED_HELPERS,
    constants: PORTFOLIO_DERIVED_CONSTANTS,
  })

  const workflowArgs = useAppRuntimeWorkflowArgs({
    ...composeAppRuntimeWorkflowInput({
      runtimeState,
      runtimeSetters,
      coreLifecycle: {
        viewMode,
        activePortfolioId,
        canUseCloud,
        marketPriceCache,
        portfolios,
        setLastUpdate,
        setPortfolios,
        setActivePortfolioId,
        setViewMode,
        upsertTargetReport,
        upsertFundamentalsEntry,
        updateReversal,
        updateTargetPrice,
        updateAlert,
        handleWatchlistUpsert,
        handleWatchlistDelete,
        cancelReview,
        switchPortfolio,
        exitOverview,
        getMarketQuotesForCodes,
      },
      portfolioDerived: {
        H,
        W,
        dossierByCode,
        totalVal,
        totalCost,
        totalPnl,
        retPct,
        todayMarketClock,
        holdingsIntegrityIssues,
        shouldTriggerPostCloseSelfHeal,
        overviewPortfolios,
        overviewTotalValue,
        overviewTotalPnl,
        overviewDuplicateHoldings,
        overviewPendingItems,
        winners,
        losers,
        top5,
        attentionCount,
        pendingCount,
        targetUpdateCount,
        dataRefreshRows,
        todayRefreshKey,
        reportRefreshCandidates,
        watchlistRows,
        watchlistFocus,
        showRelayPlan,
      },
      uiState: appUiState,
      asyncState: {
        analyzing,
        setAnalyzing,
        analyzeStep,
        setAnalyzeStep,
        researching,
        setResearching,
      },
      runtime: {
        flashSaved,
        requestAppConfirmation,
      },
      helpers: APP_RUNTIME_WORKFLOW_HELPERS,
      resources: {
        defaultNewsEvents: NEWS_EVENTS,
        stockMeta: STOCK_META,
        indColor: IND_COLOR,
        morningNote,
      },
      portfolioViewMode: PORTFOLIO_VIEW_MODE,
    }),
    refs: {
      priceSelfHealRef,
      syncPostClosePrices,
      refreshAnalystReportsRef,
      resetTradeCaptureRef,
      applyPortfolioSnapshot,
      portfolioTransitionRef,
      cloudSyncStateRef,
      livePortfolioSnapshot,
    },
  })

  const {
    copyWeeklyReport,
    backupFileInputRef,
    exportLocalBackup,
    importLocalBackup,
    portfolioPanelsData,
    portfolioPanelsActions,
  } = useAppRuntimeWorkflows(workflowArgs)

  const headerProps = useAppRuntimeHeaderProps(
    composeAppRuntimeHeaderInput({
      theme: {
        C,
        pc: pickHeaderPnlTone,
      },
      sync: {
        cloudSync,
        saved,
        copyWeeklyReport,
        exportLocalBackup,
        backupFileInputRef,
        importLocalBackup,
      },
      coreLifecycle: {
        refreshPrices,
        refreshing,
        priceSyncStatusTone,
        priceSyncStatusLabel,
        activePriceSyncAt,
        lastUpdate,
        activePortfolioId,
        switchPortfolio,
        portfolioSwitching,
        portfolioSummaries,
        createPortfolio,
        viewMode,
        exitOverview,
        openOverview,
        showPortfolioManager,
        setShowPortfolioManager,
        renamePortfolio,
        deletePortfolio,
        portfolioEditor,
        portfolioDeleteDialog,
      },
      portfolioDerived: {
        displayedTotalPnl,
        displayedRetPct,
        overviewTotalValue,
        urgentCount,
        todayAlertSummary,
      },
      notes: {
        portfolioNotes,
        setPortfolioNotes,
      },
      asyncState: {
        analyzing,
        researching,
      },
      tabs: {
        tab,
        setTab,
      },
      constants: {
        OWNER_PORTFOLIO_ID,
        PORTFOLIO_VIEW_MODE,
        OVERVIEW_VIEW_MODE,
      },
      ready,
    })
  )

  return composeAppShellFrameRuntime({
    ready,
    loadingMessage: APP_LOADING_MESSAGE,
    headerBoundaryCopy: APP_ERROR_BOUNDARY_COPY.header,
    headerProps,
    panelsData: portfolioPanelsData,
    panelsActions: portfolioPanelsActions,
    panels: {
      viewMode,
      overviewViewMode: OVERVIEW_VIEW_MODE,
      tab,
      errorBoundaryCopy: APP_ERROR_BOUNDARY_COPY,
    },
    confirmDialog: appConfirmDialog,
    closeAppConfirmDialog,
  })
}
