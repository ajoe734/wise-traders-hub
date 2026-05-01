import { useCallback, useEffect } from 'react'
import {
  CLOUD_SYNC_TTL,
  HISTORY_ENTRY_LIMIT,
  PORTFOLIO_ALIAS_TO_SUFFIX,
  STATUS_MESSAGE_TIMEOUT_MS,
} from '../constants.js'
import { syncEngine } from '../lib/syncEngine.js'
import { readSyncAt, writeSyncAt } from '../lib/portfolioUtils.js'
import { API_ENDPOINTS } from '../constants.js'

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
  setHoldingDossiers,
  setAnalysisHistory,
  setResearchHistory,
  setSaved,
  notifySaved = null,
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
  const emitSaved = useCallback(
    (message, timeout = STATUS_MESSAGE_TIMEOUT_MS.DEFAULT) => {
      if (typeof notifySaved === 'function') {
        notifySaved(message, timeout)
        return
      }
      setSaved(message)
      if (timeout != null) {
        setTimeout(() => setSaved(''), timeout)
      }
    },
    [notifySaved, setSaved]
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
    const normalized = normalizeHoldings(holdings, marketPriceCache?.prices)
    syncEngine.persistSlice('holdings', normalized, { notifySaved })
  }, [canPersistPortfolioData, holdings, marketPriceCache, normalizeHoldings, notifySaved])

  useEffect(() => {
    if (canPersistPortfolioData && tradeLog) {
      syncEngine.persistSlice('tradeLog', tradeLog, { notifySaved })
    }
  }, [canPersistPortfolioData, tradeLog, notifySaved])

  useEffect(() => {
    if (canPersistPortfolioData && targets) {
      syncEngine.persistSlice('targets', targets, { notifySaved })
    }
  }, [canPersistPortfolioData, targets, notifySaved])

  useEffect(() => {
    if (canPersistPortfolioData && fundamentals) {
      syncEngine.persistSlice('fundamentals', fundamentals, { notifySaved })
    }
  }, [canPersistPortfolioData, fundamentals, notifySaved])

  useEffect(() => {
    if (canPersistPortfolioData && watchlist) {
      syncEngine.persistSlice('watchlist', watchlist, { notifySaved })
    }
  }, [canPersistPortfolioData, watchlist, notifySaved])

  useEffect(() => {
    if (canPersistPortfolioData && analystReports) {
      syncEngine.persistSlice('analystReports', analystReports, { notifySaved })
    }
  }, [canPersistPortfolioData, analystReports, notifySaved])

  useEffect(() => {
    if (canPersistPortfolioData && reportRefreshMeta) {
      syncEngine.persistSlice('reportRefreshMeta', reportRefreshMeta, { notifySaved })
    }
  }, [canPersistPortfolioData, reportRefreshMeta, notifySaved])

  useEffect(() => {
    if (!canPersistPortfolioData || !holdings) return

    const nextDossiers = buildHoldingDossiers({
      holdings: applyMarketQuotesToHoldings(holdings, marketPriceCache?.prices),
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
      syncEngine.persistSlice('holdingDossiers', holdingDossiers, { notifySaved })
    }
  }, [canPersistPortfolioData, holdingDossiers, notifySaved])

  useEffect(() => {
    if (!canPersistPortfolioData || !newsEvents) return
    syncEngine.persistSlice('newsEvents', newsEvents, { notifySaved })
  }, [canPersistPortfolioData, newsEvents, notifySaved])

  useEffect(() => {
    if (canPersistPortfolioData && analysisHistory) {
      syncEngine.persistSlice('analysisHistory', analysisHistory, { notifySaved })
    }
  }, [canPersistPortfolioData, analysisHistory, notifySaved])

  useEffect(() => {
    if (canPersistPortfolioData && dailyReport) {
      syncEngine.persistSlice('dailyReport', dailyReport, { notifySaved })
    }
  }, [canPersistPortfolioData, dailyReport, notifySaved])

  useEffect(() => {
    if (canPersistPortfolioData && reversalConditions) {
      syncEngine.persistSlice('reversalConditions', reversalConditions, { notifySaved })
    }
  }, [canPersistPortfolioData, reversalConditions, notifySaved])

  useEffect(() => {
    if (!canPersistPortfolioData || !strategyBrain) return
    syncEngine.persistSlice('strategyBrain', strategyBrain, { notifySaved })
  }, [canPersistPortfolioData, strategyBrain, notifySaved])

  useEffect(() => {
    if (canPersistPortfolioData && brainValidation) {
      syncEngine.persistSlice('brainValidation', brainValidation, { notifySaved })
    }
  }, [canPersistPortfolioData, brainValidation, notifySaved])

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
      syncEngine.persistSlice('researchHistory', researchHistory, { notifySaved })
    }
  }, [canPersistPortfolioData, researchHistory, notifySaved])

  useEffect(() => {
    if (canPersistPortfolioData && portfolioNotes) {
      syncEngine.persistSlice('portfolioNotes', portfolioNotes, { notifySaved })
    }
  }, [canPersistPortfolioData, portfolioNotes, notifySaved])

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
