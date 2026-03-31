import { useCallback, useMemo } from 'react'
import {
  ACTIVE_PORTFOLIO_KEY,
  OWNER_PORTFOLIO_ID,
  PORTFOLIO_ALIAS_TO_SUFFIX,
  PORTFOLIO_VIEW_MODE,
  VIEW_MODE_KEY,
} from '../constants.js'
import { buildLivePortfolioSnapshot } from '../lib/appShellRuntime.js'

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
  setHoldings,
  setTradeLog,
  setTargets,
  setFundamentals,
  setWatchlist,
  setAnalystReports,
  setReportRefreshMeta,
  setHoldingDossiers,
  setNewsEvents,
  setAnalysisHistory,
  setReversalConditions,
  setStrategyBrain,
  setBrainValidation,
  setResearchHistory,
  setPortfolioNotes,
  setDailyReport,
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
  const applyPortfolioSnapshot = useCallback(
    (snapshot) => {
      const normalizedAnalysisHistory = normalizeAnalysisHistoryEntries(snapshot.analysisHistory)
      setHoldings(applyMarketQuotesToHoldings(snapshot.holdings, marketPriceCache?.prices))
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
