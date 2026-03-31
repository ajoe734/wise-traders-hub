import { useCallback, useEffect } from 'react'
import {
  API_ENDPOINTS,
  CLOUD_SAVE_DEBOUNCE,
  CLOUD_SYNC_TTL,
  HISTORY_ENTRY_LIMIT,
  PORTFOLIO_ALIAS_TO_SUFFIX,
  STATUS_MESSAGE_TIMEOUT_MS,
} from '../constants.js'

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
  readSyncAt,
  writeSyncAt,
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

  const scheduleCloudSave = useCallback(
    (action, data, successMsg) => {
      if (!cloudSyncStateRef.current.enabled) return

      clearTimeout(cloudSaveTimersRef.current[action])
      cloudSaveTimersRef.current[action] = setTimeout(async () => {
        try {
          await fetch(API_ENDPOINTS.BRAIN, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, data }),
          })
          const now = Date.now()
          cloudSyncStateRef.current.syncedAt = now
          writeSyncAt('pf-cloud-sync-at', now)
          if (successMsg) {
            emitSaved(successMsg, STATUS_MESSAGE_TIMEOUT_MS.BRIEF)
          }
        } catch {
          // best-effort cloud save; local state remains source of truth
        }
      }, CLOUD_SAVE_DEBOUNCE)
    },
    [cloudSaveTimersRef, cloudSyncStateRef, emitSaved, writeSyncAt]
  )

  useEffect(() => {
    if (!canPersistPortfolioData || !holdings) return
    const normalizedHoldings = normalizeHoldings(holdings, marketPriceCache?.prices)
    savePortfolioData(activePortfolioId, PORTFOLIO_ALIAS_TO_SUFFIX.holdings, normalizedHoldings)
    scheduleCloudSave('save-holdings', normalizedHoldings)
  }, [
    activePortfolioId,
    canPersistPortfolioData,
    holdings,
    marketPriceCache,
    normalizeHoldings,
    savePortfolioData,
    scheduleCloudSave,
  ])

  useEffect(() => {
    if (canPersistPortfolioData && tradeLog)
      savePortfolioData(activePortfolioId, PORTFOLIO_ALIAS_TO_SUFFIX.tradeLog, tradeLog)
  }, [activePortfolioId, canPersistPortfolioData, tradeLog, savePortfolioData])

  useEffect(() => {
    if (canPersistPortfolioData && targets)
      savePortfolioData(activePortfolioId, PORTFOLIO_ALIAS_TO_SUFFIX.targets, targets)
  }, [activePortfolioId, canPersistPortfolioData, targets, savePortfolioData])

  useEffect(() => {
    if (canPersistPortfolioData && fundamentals)
      savePortfolioData(activePortfolioId, PORTFOLIO_ALIAS_TO_SUFFIX.fundamentals, fundamentals)
  }, [activePortfolioId, canPersistPortfolioData, fundamentals, savePortfolioData])

  useEffect(() => {
    if (canPersistPortfolioData && watchlist)
      savePortfolioData(activePortfolioId, PORTFOLIO_ALIAS_TO_SUFFIX.watchlist, watchlist)
  }, [activePortfolioId, canPersistPortfolioData, watchlist, savePortfolioData])

  useEffect(() => {
    if (canPersistPortfolioData && analystReports) {
      savePortfolioData(activePortfolioId, PORTFOLIO_ALIAS_TO_SUFFIX.analystReports, analystReports)
    }
  }, [activePortfolioId, analystReports, canPersistPortfolioData, savePortfolioData])

  useEffect(() => {
    if (canPersistPortfolioData && reportRefreshMeta) {
      savePortfolioData(activePortfolioId, 'report-refresh-meta-v1', reportRefreshMeta)
    }
  }, [activePortfolioId, canPersistPortfolioData, reportRefreshMeta, savePortfolioData])

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
      savePortfolioData(
        activePortfolioId,
        PORTFOLIO_ALIAS_TO_SUFFIX.holdingDossiers,
        holdingDossiers
      )
    }
  }, [activePortfolioId, canPersistPortfolioData, holdingDossiers, savePortfolioData])

  useEffect(() => {
    if (!canPersistPortfolioData || !newsEvents) return
    savePortfolioData(activePortfolioId, PORTFOLIO_ALIAS_TO_SUFFIX.newsEvents, newsEvents)
    scheduleCloudSave('save-events', newsEvents)
  }, [activePortfolioId, canPersistPortfolioData, newsEvents, savePortfolioData, scheduleCloudSave])

  useEffect(() => {
    if (canPersistPortfolioData && analysisHistory) {
      savePortfolioData(
        activePortfolioId,
        PORTFOLIO_ALIAS_TO_SUFFIX.analysisHistory,
        analysisHistory
      )
    }
  }, [activePortfolioId, analysisHistory, canPersistPortfolioData, savePortfolioData])

  useEffect(() => {
    if (canPersistPortfolioData && dailyReport)
      savePortfolioData(activePortfolioId, PORTFOLIO_ALIAS_TO_SUFFIX.dailyReport, dailyReport)
  }, [activePortfolioId, canPersistPortfolioData, dailyReport, savePortfolioData])

  useEffect(() => {
    if (canPersistPortfolioData && reversalConditions) {
      savePortfolioData(
        activePortfolioId,
        PORTFOLIO_ALIAS_TO_SUFFIX.reversalConditions,
        reversalConditions
      )
    }
  }, [activePortfolioId, canPersistPortfolioData, reversalConditions, savePortfolioData])

  useEffect(() => {
    if (!canPersistPortfolioData || !strategyBrain) return
    savePortfolioData(activePortfolioId, PORTFOLIO_ALIAS_TO_SUFFIX.strategyBrain, strategyBrain)
    scheduleCloudSave('save-brain', strategyBrain)
  }, [
    activePortfolioId,
    canPersistPortfolioData,
    strategyBrain,
    savePortfolioData,
    scheduleCloudSave,
  ])

  useEffect(() => {
    if (canPersistPortfolioData && brainValidation) {
      savePortfolioData(activePortfolioId, 'brain-validation-v1', brainValidation)
    }
  }, [activePortfolioId, brainValidation, canPersistPortfolioData, savePortfolioData])

  useEffect(() => {
    const lastAnalysisSyncAt = readSyncAt('pf-analysis-cloud-sync-at')
    const shouldFetchAnalysis =
      canUseCloud &&
      (tab === 'daily' || tab === 'log') &&
      (!lastAnalysisSyncAt || Date.now() - lastAnalysisSyncAt > CLOUD_SYNC_TTL)
    if (!shouldFetchAnalysis) return

    fetch(`${API_ENDPOINTS.BRAIN}?action=history`)
      .then((res) => res.json())
      .then((data) => {
        const historyRows = ensureArray(data?.history)
        if (historyRows.length === 0) return
        setAnalysisHistory((prev) => {
          const uniqueHistory = normalizeAnalysisHistoryEntries([...(prev || []), ...historyRows])
          savePortfolioData(
            activePortfolioId,
            PORTFOLIO_ALIAS_TO_SUFFIX.analysisHistory,
            uniqueHistory
          )
          return uniqueHistory
        })
        writeSyncAt('pf-analysis-cloud-sync-at', Date.now())
      })
      .catch(() => {})
  }, [
    activePortfolioId,
    canUseCloud,
    tab,
    readSyncAt,
    setAnalysisHistory,
    normalizeAnalysisHistoryEntries,
    savePortfolioData,
    writeSyncAt,
  ])

  useEffect(() => {
    const lastResearchSyncAt = readSyncAt('pf-research-cloud-sync-at')
    const shouldFetchResearch =
      canUseCloud &&
      tab === 'research' &&
      (!lastResearchSyncAt || Date.now() - lastResearchSyncAt > CLOUD_SYNC_TTL)
    if (!shouldFetchResearch) return

    fetch(API_ENDPOINTS.RESEARCH)
      .then((res) => res.json())
      .then((data) => {
        const reportRows = ensureArray(data?.reports)
        if (reportRows.length === 0) return
        const uniqueReports = mergeResearchHistory(researchHistory, reportRows)
        setResearchHistory(uniqueReports)
        savePortfolioData(
          activePortfolioId,
          PORTFOLIO_ALIAS_TO_SUFFIX.researchHistory,
          uniqueReports
        )
        writeSyncAt('pf-research-cloud-sync-at', Date.now())
      })
      .catch(() => {})
  }, [
    activePortfolioId,
    canUseCloud,
    researchHistory,
    tab,
    readSyncAt,
    setResearchHistory,
    savePortfolioData,
    writeSyncAt,
  ])

  useEffect(() => {
    if (canPersistPortfolioData && researchHistory) {
      savePortfolioData(
        activePortfolioId,
        PORTFOLIO_ALIAS_TO_SUFFIX.researchHistory,
        researchHistory
      )
    }
  }, [activePortfolioId, canPersistPortfolioData, researchHistory, savePortfolioData])

  useEffect(() => {
    if (canPersistPortfolioData && portfolioNotes) {
      savePortfolioData(activePortfolioId, PORTFOLIO_ALIAS_TO_SUFFIX.portfolioNotes, portfolioNotes)
    }
  }, [activePortfolioId, canPersistPortfolioData, portfolioNotes, savePortfolioData])

  useEffect(
    () => () => {
      Object.values(cloudSaveTimersRef.current).forEach(clearTimeout)
    },
    [cloudSaveTimersRef]
  )
}
