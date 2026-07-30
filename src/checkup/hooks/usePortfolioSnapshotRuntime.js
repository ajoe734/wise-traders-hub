import { useCallback, useMemo } from 'react'
import { mergeAuthoritativeIntoPriceCache } from '../lib/authoritativePriceMirror'
import {
  ACTIVE_PORTFOLIO_KEY,
  OWNER_PORTFOLIO_ID,
  PORTFOLIO_ALIAS_TO_SUFFIX,
  PORTFOLIO_VIEW_MODE,
  VIEW_MODE_KEY,
} from '../constants.js'
import { buildLivePortfolioSnapshot } from '../lib/appShellRuntime.js'
// Phase 3A.4 Step 1: store 直取 setter
import { useHoldingsStore } from '../stores/holdingsStore.js'
import { useEventStore } from '../stores/eventStore.js'
import { useReportsStore } from '../stores/reportsStore.js'
import { useBrainStore } from '../stores/brainStore.js'

export function usePortfolioSnapshotRuntime({
  ready,
  marketPriceCache,
  cloudSyncStateRef,
  portfolioSetterRef,
  setCloudSync,
  holdings,
  tradeLog,
  targets,
  fundamentals,
  watchlist,
  analystReports,
  reportRefreshMeta,
  holdingDossiers,
  newsEvents,
  analysisHistory,
  dailyReport,
  reversalConditions,
  strategyBrain,
  researchHistory,
  portfolioNotes,
  setPortfolioNotes,
  normalizeAnalysisHistoryEntries,
  applyMarketQuotesToHoldings,
  normalizeFundamentalsStore,
  normalizeWatchlist,
  normalizeAnalystReportsStore,
  normalizeReportRefreshMeta,
  normalizeHoldingDossiers,
  normalizeNewsEvents,
  normalizeStrategyBrain,
  normalizeBrainValidationStore,
  normalizeDailyReportEntry,
  clonePortfolioNotes,
  loadPortfolioSnapshot,
  readSyncAt,
  save,
  savePortfolioData,
}) {
  // Override prop setters with store-backed setters (Phase 3A.4 Step 1)
  const setHoldings = useHoldingsStore((s) => s.setHoldings)
  const setTradeLog = useHoldingsStore((s) => s.setTradeLog)
  const setTargets = useHoldingsStore((s) => s.setTargets)
  const setFundamentals = useHoldingsStore((s) => s.setFundamentals)
  const setWatchlist = useHoldingsStore((s) => s.setWatchlist)
  const setAnalystReports = useHoldingsStore((s) => s.setAnalystReports)
  const setReportRefreshMeta = useHoldingsStore((s) => s.setReportRefreshMeta)
  const setHoldingDossiers = useHoldingsStore((s) => s.setHoldingDossiers)
  const setReversalConditions = useHoldingsStore((s) => s.setReversalConditions)
  const setNewsEvents = useEventStore((s) => s.setNewsEvents)
  const setAnalysisHistory = useReportsStore((s) => s.setAnalysisHistory)
  const setResearchHistory = useReportsStore((s) => s.setResearchHistory)
  const setDailyReport = useReportsStore((s) => s.setDailyReport)
  const setStrategyBrain = useBrainStore((s) => s.setStrategyBrain)
  const setBrainValidation = useBrainStore((s) => s.setBrainValidation)
  const applyPortfolioSnapshot = useCallback(
    (snapshot) => {
      const normalizedAnalysisHistory = normalizeAnalysisHistoryEntries(snapshot.analysisHistory)
      setHoldings(applyMarketQuotesToHoldings(snapshot.holdings, mergeAuthoritativeIntoPriceCache(marketPriceCache)?.prices))
      setTradeLog(snapshot.tradeLog)
      setTargets(snapshot.targets)
      setFundamentals(normalizeFundamentalsStore(snapshot.fundamentals))
      setWatchlist(normalizeWatchlist(snapshot.watchlist))
      setAnalystReports(normalizeAnalystReportsStore(snapshot.analystReports))
      setReportRefreshMeta(normalizeReportRefreshMeta(snapshot.reportRefreshMeta))
      setHoldingDossiers(normalizeHoldingDossiers(snapshot.holdingDossiers))
      setNewsEvents(normalizeNewsEvents(snapshot.newsEvents))
      setAnalysisHistory(normalizedAnalysisHistory)
      setReversalConditions(snapshot.reversalConditions)
      setStrategyBrain(normalizeStrategyBrain(snapshot.strategyBrain))
      setBrainValidation(normalizeBrainValidationStore(snapshot.brainValidation))
      setResearchHistory(snapshot.researchHistory)
      setPortfolioNotes(snapshot.portfolioNotes || clonePortfolioNotes())
      setDailyReport(
        normalizeDailyReportEntry(snapshot.dailyReport) ||
          (normalizedAnalysisHistory.length > 0 ? normalizedAnalysisHistory[0] : null)
      )
    },
    [
      applyMarketQuotesToHoldings,
      clonePortfolioNotes,
      marketPriceCache,
      normalizeAnalysisHistoryEntries,
      normalizeAnalystReportsStore,
      normalizeBrainValidationStore,
      normalizeDailyReportEntry,
      normalizeFundamentalsStore,
      normalizeHoldingDossiers,
      normalizeNewsEvents,
      normalizeReportRefreshMeta,
      normalizeStrategyBrain,
      normalizeWatchlist,
      setAnalysisHistory,
      setAnalystReports,
      setBrainValidation,
      setDailyReport,
      setFundamentals,
      setHoldingDossiers,
      setHoldings,
      setNewsEvents,
      setPortfolioNotes,
      setReportRefreshMeta,
      setResearchHistory,
      setReversalConditions,
      setStrategyBrain,
      setTargets,
      setTradeLog,
      setWatchlist,
    ]
  )

  const setCloudStateForPortfolio = useCallback(
    (pid, nextViewMode = PORTFOLIO_VIEW_MODE) => {
      const enabled = nextViewMode === PORTFOLIO_VIEW_MODE && pid === OWNER_PORTFOLIO_ID
      cloudSyncStateRef.current = {
        enabled,
        syncedAt: enabled ? readSyncAt('pf-cloud-sync-at') : 0,
      }
      setCloudSync(enabled)
    },
    [cloudSyncStateRef, readSyncAt, setCloudSync]
  )

  const livePortfolioSnapshot = useMemo(
    () =>
      buildLivePortfolioSnapshot({
        holdings,
        tradeLog,
        targets,
        fundamentals,
        watchlist,
        analystReports,
        reportRefreshMeta,
        holdingDossiers,
        newsEvents,
        analysisHistory,
        dailyReport,
        reversalConditions,
        strategyBrain,
        researchHistory,
        portfolioNotes,
      }),
    [
      holdings,
      tradeLog,
      targets,
      fundamentals,
      watchlist,
      analystReports,
      reportRefreshMeta,
      holdingDossiers,
      newsEvents,
      analysisHistory,
      dailyReport,
      reversalConditions,
      strategyBrain,
      researchHistory,
      portfolioNotes,
    ]
  )

  const flushCurrentPortfolio = useCallback(
    async (pid) => {
      if (!ready || !pid) return

      await Promise.all(
        Object.entries(livePortfolioSnapshot)
          .map(([alias, value]) => {
            const suffix = PORTFOLIO_ALIAS_TO_SUFFIX[alias]
            return suffix ? savePortfolioData(pid, suffix, value) : null
          })
          .filter(Boolean)
      )

      await save(ACTIVE_PORTFOLIO_KEY, pid)
      await save(VIEW_MODE_KEY, PORTFOLIO_VIEW_MODE)
    },
    [livePortfolioSnapshot, ready, save, savePortfolioData]
  )

  const loadPortfolio = useCallback(
    async (pid, nextViewMode = PORTFOLIO_VIEW_MODE) => {
      const snapshot = await loadPortfolioSnapshot(pid)
      portfolioSetterRef.current.setActivePortfolioId(pid)
      portfolioSetterRef.current.setViewMode(nextViewMode)
      applyPortfolioSnapshot(snapshot)
      setCloudStateForPortfolio(pid, nextViewMode)
      return snapshot
    },
    [applyPortfolioSnapshot, loadPortfolioSnapshot, portfolioSetterRef, setCloudStateForPortfolio]
  )

  return {
    applyPortfolioSnapshot,
    flushCurrentPortfolio,
    livePortfolioSnapshot,
    loadPortfolio,
  }
}
