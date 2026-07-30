import { API_ENDPOINTS } from '../constants.js'
import { useEffect } from 'react'
import { getCheckupGateway } from '../lib/gateway'
import { CLOUD_SYNC_TTL, OWNER_PORTFOLIO_ID } from '../constants.js'
import { runWhenIdle } from '../../lib/idleSchedule'
// Phase 3A.4 Step 1: store-backed setters 由 hook 內部直接從 store 取，
// 上游 props 仍接收（向後相容），但會被 store 版本覆寫。
import { useHoldingsStore } from '../stores/holdingsStore.js'
import { useEventStore } from '../stores/eventStore.js'
import { useBrainStore } from '../stores/brainStore.js'
import { useReportsStore } from '../stores/reportsStore.js'

function ensureArray(value) {
  return Array.isArray(value) ? value : []
}

export function usePortfolioBootstrap({
  bootRuntimeRef,
  setReady,
  setCloudSync,
  cloudSyncStateRef,
  migrateLegacyPortfolioStorageIfNeeded,
  seedJinlianchengIfNeeded,
  ensurePortfolioRegistry,
  applyTradeBackfillPatchesIfNeeded,
  loadPortfolioSnapshot,
  readSyncAt,
  writeSyncAt,
  shouldAdoptCloudHoldings,
  normalizeHoldings,
  buildHoldingPriceHints,
  getPortfolioFallback,
  savePortfolioData,
  normalizeStrategyBrain,
  normalizeNewsEvents,
  normalizeAnalysisHistoryEntries,
  normalizeDailyReportEntry,
}) {
  // Phase 3A.4 Step 1: store 直取 setter，覆寫上游 prop drilling
  const setHoldings = useHoldingsStore((s) => s.setHoldings)
  const setStrategyBrain = useBrainStore((s) => s.setStrategyBrain)
  const setNewsEvents = useEventStore((s) => s.setNewsEvents)
  const setAnalysisHistory = useReportsStore((s) => s.setAnalysisHistory)
  const setDailyReport = useReportsStore((s) => s.setDailyReport)
  const setResearchHistory = useReportsStore((s) => s.setResearchHistory)
  // 標記 props 已被 store 取代（為了不報未使用 lint）

  useEffect(() => {
    let cancelled = false

    const runBootstrap = async () => {
      const runtime = bootRuntimeRef.current
      if (!runtime) return

      const {
        activePortfolioId,
        marketPriceQuotes,
        applyPortfolioSnapshot,
        setPortfolios,
        setActivePortfolioId,
        setViewMode,
        portfolioTransitionRef,
      } = runtime

      portfolioTransitionRef.current = {
        isHydrating: true,
        fromPid: activePortfolioId,
        toPid: activePortfolioId,
      }

      await migrateLegacyPortfolioStorageIfNeeded()
      await seedJinlianchengIfNeeded()
      const registry = await ensurePortfolioRegistry()
      await applyTradeBackfillPatchesIfNeeded()

      const pid = registry.activePortfolioId
      const snapshot = await loadPortfolioSnapshot(pid)
      if (cancelled) return

      setPortfolios(registry.portfolios)
      setActivePortfolioId(pid)
      setViewMode(registry.viewMode)
      applyPortfolioSnapshot(snapshot)
      setReady(true)

      // Cloud sync is non-blocking for first paint — defer to browser idle
      // so the 1-5 edge-function fetches don't compete with React mount.
      const runCloudSync = async () => {
        if (cancelled) return

      const lastCloudSyncAt = readSyncAt('pf-cloud-sync-at')
      const shouldSyncCloud =
        pid === OWNER_PORTFOLIO_ID &&
        (!lastCloudSyncAt || Date.now() - lastCloudSyncAt > CLOUD_SYNC_TTL)

      cloudSyncStateRef.current = {
        enabled: false,
        syncedAt: lastCloudSyncAt,
      }

      if (pid !== OWNER_PORTFOLIO_ID) {
        setCloudSync(false)
        portfolioTransitionRef.current = {
          isHydrating: false,
          fromPid: pid,
          toPid: pid,
        }
        return
      }

      if (!shouldSyncCloud) {
        try {
          const cloudHoldings = await getCheckupGateway().http.json(API_ENDPOINTS.BRAIN, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'load-holdings' }),
          })

          const cloudRows = cloudHoldings?.holdings
          if (
            !cancelled &&
            Array.isArray(cloudRows) &&
            cloudRows.length > 0 &&
            shouldAdoptCloudHoldings(snapshot.holdings, cloudRows)
          ) {
            const normalizedCloudHoldings = normalizeHoldings(
              cloudRows,
              marketPriceQuotes,
              buildHoldingPriceHints({
                analysisHistory: snapshot.analysisHistory,
                fallbackRows: getPortfolioFallback(pid, 'holdings-v2'),
              })
            )
            snapshot.holdings = normalizedCloudHoldings
            setHoldings(normalizedCloudHoldings)
            savePortfolioData(pid, 'holdings-v2', normalizedCloudHoldings)
          }
        } catch {
          // localStorage fallback keeps app usable offline
        }

        cloudSyncStateRef.current = {
          enabled: true,
          syncedAt: readSyncAt('pf-cloud-sync-at'),
        }
        setCloudSync(true)
        portfolioTransitionRef.current = {
          isHydrating: false,
          fromPid: pid,
          toPid: pid,
        }
        return
      }

      try {
        const gw = getCheckupGateway()
        const [cloudBrain, cloudEvents, cloudHoldings, cloudHistory, cloudResearch] =
          await Promise.all([
            gw.http.tryJson(`${API_ENDPOINTS.BRAIN}?action=brain`).then((r) => r || { brain: null }),
            gw.http
              .tryJson(API_ENDPOINTS.BRAIN, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'load-events' }),
              })
              .then((r) => r || { events: null }),
            gw.http
              .tryJson(API_ENDPOINTS.BRAIN, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'load-holdings' }),
              })
              .then((r) => r || { holdings: null }),
            gw.http.tryJson(`${API_ENDPOINTS.BRAIN}?action=history`).then((r) => r || { history: null }),
            gw.http.tryJson(API_ENDPOINTS.RESEARCH).then((r) => r || { reports: null }),
          ])
        if (cancelled) return

        if (cloudBrain.brain && !snapshot.strategyBrain) {
          const normalizedBrain = normalizeStrategyBrain(cloudBrain.brain)
          setStrategyBrain(normalizedBrain)
          savePortfolioData(pid, 'brain-v1', normalizedBrain)
        }

        const cloudEventRows = ensureArray(cloudEvents?.events)
        if (
          cloudEventRows.length > 0 &&
          (!snapshot.newsEvents || snapshot.newsEvents.length === 0)
        ) {
          const normalizedEvents = normalizeNewsEvents(cloudEventRows)
          setNewsEvents(normalizedEvents)
          savePortfolioData(pid, 'news-events-v1', normalizedEvents)
        }

        const cloudRows = ensureArray(cloudHoldings?.holdings)
        if (cloudRows.length > 0 && shouldAdoptCloudHoldings(snapshot.holdings, cloudRows)) {
          const normalizedCloudHoldings = normalizeHoldings(
            cloudRows,
            marketPriceQuotes,
            buildHoldingPriceHints({
              analysisHistory: snapshot.analysisHistory,
              fallbackRows: getPortfolioFallback(pid, 'holdings-v2'),
            })
          )
          snapshot.holdings = normalizedCloudHoldings
          setHoldings(normalizedCloudHoldings)
          savePortfolioData(pid, 'holdings-v2', normalizedCloudHoldings)
        }

        const cloudHistoryRows = ensureArray(cloudHistory?.history)
        if (cloudHistoryRows.length > 0) {
          const uniqueHistory = normalizeAnalysisHistoryEntries([
            ...(snapshot.analysisHistory || []),
            ...cloudHistoryRows,
          ])
          setAnalysisHistory(uniqueHistory)
          savePortfolioData(pid, 'analysis-history-v1', uniqueHistory)
          writeSyncAt('pf-analysis-cloud-sync-at', Date.now())
          if (!snapshot.dailyReport && uniqueHistory.length > 0) {
            setDailyReport(normalizeDailyReportEntry(uniqueHistory[0]))
          }
        }

        const cloudResearchRows = ensureArray(cloudResearch?.reports)
        if (cloudResearchRows.length > 0) {
          const uniqueReports = [...(snapshot.researchHistory || []), ...cloudResearchRows]
            .filter(
              (report, index, rows) =>
                rows.findIndex((item) => item.timestamp === report.timestamp) === index
            )
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 30)
          setResearchHistory(uniqueReports)
          savePortfolioData(pid, 'research-history-v1', uniqueReports)
          writeSyncAt('pf-research-cloud-sync-at', Date.now())
        }

        const syncedAt = Date.now()
        cloudSyncStateRef.current = {
          enabled: true,
          syncedAt,
        }
        writeSyncAt('pf-cloud-sync-at', syncedAt)
        setCloudSync(true)
      } catch {
        // localStorage fallback keeps app usable offline
      } finally {
        portfolioTransitionRef.current = {
          isHydrating: false,
          fromPid: pid,
          toPid: pid,
        }
      }
      }
      runWhenIdle(() => {
        void runCloudSync()
      }, 3000)
    }

    runBootstrap()

    return () => {
      cancelled = true
    }
  }, [
    bootRuntimeRef,
    setReady,
    setCloudSync,
    cloudSyncStateRef,
    setHoldings,
    setStrategyBrain,
    setNewsEvents,
    setAnalysisHistory,
    setDailyReport,
    setResearchHistory,
    migrateLegacyPortfolioStorageIfNeeded,
    seedJinlianchengIfNeeded,
    ensurePortfolioRegistry,
    applyTradeBackfillPatchesIfNeeded,
    loadPortfolioSnapshot,
    readSyncAt,
    writeSyncAt,
    shouldAdoptCloudHoldings,
    normalizeHoldings,
    buildHoldingPriceHints,
    getPortfolioFallback,
    savePortfolioData,
    normalizeStrategyBrain,
    normalizeNewsEvents,
    normalizeAnalysisHistoryEntries,
    normalizeDailyReportEntry,
  ])
}
