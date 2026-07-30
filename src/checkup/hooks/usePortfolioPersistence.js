import { useCallback, useEffect } from 'react'
import { mergeAuthoritativeIntoPriceCache } from '../lib/authoritativePriceMirror'
import {
  CLOUD_SYNC_TTL,
  HISTORY_ENTRY_LIMIT,
  PORTFOLIO_ALIAS_TO_SUFFIX,
  STATUS_MESSAGE_TIMEOUT_MS,
} from '../constants.js'
import { syncEngine } from '../lib/syncEngine.js'
import { readSyncAt, writeSyncAt } from '../lib/portfolioUtils.js'
import { API_ENDPOINTS } from '../constants.js'
// Phase 3A.4 Step 1: store-backed setters 從 store 直取
import { useHoldingsStore } from '../stores/holdingsStore.js'
import { useReportsStore } from '../stores/reportsStore.js'

function mergeResearchHistory(existingReports, incomingReports) {
  return [...(existingReports || []), ...(incomingReports || [])]
    .filter(
      (report, index, rows) =>
        rows.findIndex((item) => item.timestamp === report.timestamp) === index
    )
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, HISTORY_ENTRY_LIMIT)
}

function ensureArray(value) {
  return Array.isArray(value) ? value : []
}

export function usePortfolioPersistence({
  activePortfolioId,
  canPersistPortfolioData,
  canUseCloud,
  tab,
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
  brainValidation,
  researchHistory,
  portfolioNotes,
  marketPriceCache,
  marketPriceSync,
  setSaved = () => {},
  flashSaved = null,
  cloudSyncStateRef,
  cloudSaveTimersRef,
  normalizeHoldings,
  savePortfolioData,
  buildHoldingDossiers,
  applyMarketQuotesToHoldings,
  normalizeHoldingDossiers,
  normalizeAnalysisHistoryEntries,
  // readSyncAt / writeSyncAt 仍從 helpers 收進來（向後相容）但本檔不再使用
  readSyncAt: _readSyncAt,
  writeSyncAt: _writeSyncAt,
}) {
  // Phase 3A.4 Step 1: store 直取 setter
  const setHoldingDossiers = useHoldingsStore((s) => s.setHoldingDossiers)
  const setAnalysisHistory = useReportsStore((s) => s.setAnalysisHistory)
  const setResearchHistory = useReportsStore((s) => s.setResearchHistory)

  const emitSaved = useCallback(
    (message, timeout = STATUS_MESSAGE_TIMEOUT_MS.DEFAULT) => {
      if (typeof flashSaved === 'function') {
        flashSaved(message, timeout)
        return
      }
      setSaved(message)
      if (timeout != null) {
        setTimeout(() => setSaved(''), timeout)
      }
    },
    [flashSaved, setSaved]
  )

  // 把 syncEngine 的 cloud-enabled state 寫回 cloudSyncStateRef，維持下游相容
  useEffect(() => {
    const status = syncEngine.getStatus()
    if (cloudSyncStateRef?.current) {
      cloudSyncStateRef.current.enabled = status.enabled
      cloudSyncStateRef.current.syncedAt = status.syncedAt
    }
  }, [activePortfolioId, canUseCloud, cloudSyncStateRef])

  // === local + cloud 雙寫（透過 syncEngine） ===

  useEffect(() => {
    if (!canPersistPortfolioData || !holdings) return
    const normalized = normalizeHoldings(holdings, mergeAuthoritativeIntoPriceCache(marketPriceCache)?.prices)
    syncEngine.persistSlice('holdings', normalized, { flashSaved })
  }, [canPersistPortfolioData, holdings, marketPriceCache, normalizeHoldings, flashSaved])

  useEffect(() => {
    if (canPersistPortfolioData && tradeLog) {
      syncEngine.persistSlice('tradeLog', tradeLog, { flashSaved })
    }
  }, [canPersistPortfolioData, tradeLog, flashSaved])

  useEffect(() => {
    if (canPersistPortfolioData && targets) {
      syncEngine.persistSlice('targets', targets, { flashSaved })
    }
  }, [canPersistPortfolioData, targets, flashSaved])

  useEffect(() => {
    if (canPersistPortfolioData && fundamentals) {
      syncEngine.persistSlice('fundamentals', fundamentals, { flashSaved })
    }
  }, [canPersistPortfolioData, fundamentals, flashSaved])

  useEffect(() => {
    if (canPersistPortfolioData && watchlist) {
      syncEngine.persistSlice('watchlist', watchlist, { flashSaved })
    }
  }, [canPersistPortfolioData, watchlist, flashSaved])

  useEffect(() => {
    if (canPersistPortfolioData && analystReports) {
      syncEngine.persistSlice('analystReports', analystReports, { flashSaved })
    }
  }, [canPersistPortfolioData, analystReports, flashSaved])

  useEffect(() => {
    if (canPersistPortfolioData && reportRefreshMeta) {
      syncEngine.persistSlice('reportRefreshMeta', reportRefreshMeta, { flashSaved })
    }
  }, [canPersistPortfolioData, reportRefreshMeta, flashSaved])

  useEffect(() => {
    if (!canPersistPortfolioData || !holdings) return

    const nextDossiers = buildHoldingDossiers({
      holdings: applyMarketQuotesToHoldings(holdings, mergeAuthoritativeIntoPriceCache(marketPriceCache)?.prices),
      watchlist,
      targets,
      fundamentals,
      analystReports,
      newsEvents,
      researchHistory,
      strategyBrain,
      marketPriceCache,
      marketPriceSync,
    })
    const prevJson = JSON.stringify(normalizeHoldingDossiers(holdingDossiers))
    const nextJson = JSON.stringify(nextDossiers)
    if (prevJson !== nextJson) {
      setHoldingDossiers(nextDossiers)
    }
  }, [
    canPersistPortfolioData,
    holdings,
    holdingDossiers,
    marketPriceCache,
    marketPriceSync,
    newsEvents,
    researchHistory,
    strategyBrain,
    targets,
    fundamentals,
    watchlist,
    analystReports,
    buildHoldingDossiers,
    applyMarketQuotesToHoldings,
    normalizeHoldingDossiers,
    setHoldingDossiers,
  ])

  useEffect(() => {
    if (canPersistPortfolioData && holdingDossiers) {
      syncEngine.persistSlice('holdingDossiers', holdingDossiers, { flashSaved })
    }
  }, [canPersistPortfolioData, holdingDossiers, flashSaved])

  useEffect(() => {
    if (!canPersistPortfolioData || !newsEvents) return
    syncEngine.persistSlice('newsEvents', newsEvents, { flashSaved })
  }, [canPersistPortfolioData, newsEvents, flashSaved])

  useEffect(() => {
    if (canPersistPortfolioData && analysisHistory) {
      syncEngine.persistSlice('analysisHistory', analysisHistory, { flashSaved })
    }
  }, [canPersistPortfolioData, analysisHistory, flashSaved])

  useEffect(() => {
    if (canPersistPortfolioData && dailyReport) {
      syncEngine.persistSlice('dailyReport', dailyReport, { flashSaved })
    }
  }, [canPersistPortfolioData, dailyReport, flashSaved])

  useEffect(() => {
    if (canPersistPortfolioData && reversalConditions) {
      syncEngine.persistSlice('reversalConditions', reversalConditions, { flashSaved })
    }
  }, [canPersistPortfolioData, reversalConditions, flashSaved])

  useEffect(() => {
    if (!canPersistPortfolioData || !strategyBrain) return
    syncEngine.persistSlice('strategyBrain', strategyBrain, { flashSaved })
  }, [canPersistPortfolioData, strategyBrain, flashSaved])

  useEffect(() => {
    if (canPersistPortfolioData && brainValidation) {
      syncEngine.persistSlice('brainValidation', brainValidation, { flashSaved })
    }
  }, [canPersistPortfolioData, brainValidation, flashSaved])

  // === cloud → local 拉取（含 TTL）===

  useEffect(() => {
    const shouldFetch = canUseCloud && (tab === 'daily' || tab === 'log')
    if (!shouldFetch) return

    let cancelled = false
    syncEngine.fetchCloudSlice('analysisHistory').then((rows) => {
      if (cancelled) return
      const historyRows = ensureArray(rows)
      if (historyRows.length === 0) return
      setAnalysisHistory((prev) => {
        const uniqueHistory = normalizeAnalysisHistoryEntries([...(prev || []), ...historyRows])
        syncEngine.persistSlice('analysisHistory', uniqueHistory, { skipCloud: true })
        return uniqueHistory
      })
    })
    return () => {
      cancelled = true
    }
  }, [activePortfolioId, canUseCloud, tab, setAnalysisHistory, normalizeAnalysisHistoryEntries])

  useEffect(() => {
    const shouldFetch = canUseCloud && tab === 'research'
    if (!shouldFetch) return

    let cancelled = false
    syncEngine.fetchCloudSlice('researchHistory').then((rows) => {
      if (cancelled) return
      const reportRows = ensureArray(rows)
      if (reportRows.length === 0) return
      const uniqueReports = mergeResearchHistory(researchHistory, reportRows)
      setResearchHistory(uniqueReports)
      syncEngine.persistSlice('researchHistory', uniqueReports, { skipCloud: true })
    })
    return () => {
      cancelled = true
    }
  }, [activePortfolioId, canUseCloud, researchHistory, tab, setResearchHistory])

  useEffect(() => {
    if (canPersistPortfolioData && researchHistory) {
      syncEngine.persistSlice('researchHistory', researchHistory, { flashSaved })
    }
  }, [canPersistPortfolioData, researchHistory, flashSaved])

  useEffect(() => {
    if (canPersistPortfolioData && portfolioNotes) {
      syncEngine.persistSlice('portfolioNotes', portfolioNotes, { flashSaved })
    }
  }, [canPersistPortfolioData, portfolioNotes, flashSaved])

  useEffect(
    () => () => {
      // 卸載時清除 syncEngine 內部 timers 與舊 cloudSaveTimersRef
      syncEngine.cancelAll()
      if (cloudSaveTimersRef?.current) {
        Object.values(cloudSaveTimersRef.current).forEach(clearTimeout)
      }
    },
    [cloudSaveTimersRef]
  )
}
