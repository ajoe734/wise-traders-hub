import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useSavedToast } from './useSavedToast.js'
import { useTransientUiActions } from './useTransientUiActions.js'
import { useWatchlistActions } from './useWatchlistActions.js'
import {
  buildPortfolioRoute,
  ACTIVE_PORTFOLIO_KEY,
  OWNER_PORTFOLIO_ID,
  OVERVIEW_VIEW_MODE,
  PORTFOLIOS_KEY,
  PORTFOLIO_STORAGE_FIELDS,
  PORTFOLIO_VIEW_MODE,
  VIEW_MODE_KEY,
} from '../constants.js'
import { normalizeStrategyBrain } from '../lib/brainRuntime.js'
import { createDefaultReviewForm, normalizeNewsEvents, toSlashDate } from '../lib/eventUtils.js'
import { applyTradeEntryToHoldings, normalizeHoldings } from '../lib/holdings.js'
import { buildPortfolioTabs } from '../lib/navigationTabs.js'
import {
  buildPortfolioSummariesFromStorage,
  buildHoldingAlertSummary,
  readPortfolioRuntimeSnapshot,
  readRouteMarketState,
  readRuntimePortfolios,
} from '../lib/routeRuntime.js'
import {
  clonePortfolioNotes,
  collectPortfolioBackupStorage,
  downloadJson,
  getPortfolioFallback,
  normalizeBackupStorage,
  normalizePortfolios,
  pfKey,
  save,
  savePortfolioData,
} from '../lib/portfolioUtils.js'
import {
  normalizeAnalysisHistoryEntries,
  normalizeAnalystReportsStore,
  normalizeDailyReportEntry,
} from '../lib/reportUtils.js'
import { normalizeWatchlist } from '../lib/watchlistUtils.js'
import {
  createDefaultFundamentalDraft,
  normalizeFundamentalsStore,
  normalizeHoldingDossiers,
} from '../lib/dossierUtils.js'
import { C } from '../theme.js'

function normalizePortfolioNotes(value) {
  return value && typeof value === 'object'
    ? { ...clonePortfolioNotes(), ...value }
    : clonePortfolioNotes()
}

function buildClipboardReport({
  portfolioName,
  holdings,
  totalValue,
  totalPnl,
  retPct,
  todayAlertSummary,
}) {
  const topRows = [...(Array.isArray(holdings) ? holdings : [])]
    .sort((a, b) => (b.value || 0) - (a.value || 0))
    .slice(0, 5)
    .map(
      (item) =>
        `- ${item.name}(${item.code}) ${item.qty}股 / ${item.pct >= 0 ? '+' : ''}${(item.pct || 0).toFixed(2)}%`
    )

  return [
    `組合：${portfolioName}`,
    `日期：${toSlashDate()}`,
    `總市值：${Math.round(totalValue).toLocaleString()}`,
    `總損益：${totalPnl >= 0 ? '+' : ''}${Math.round(totalPnl).toLocaleString()} (${retPct >= 0 ? '+' : ''}${retPct.toFixed(2)}%)`,
    `今日提醒：${todayAlertSummary || '無'}`,
    'Top 持股：',
    ...(topRows.length > 0 ? topRows : ['- 尚無持股']),
  ].join('\n')
}

function createPortfolioEditorState() {
  return {
    isOpen: false,
    mode: 'create',
    name: '',
    targetId: null,
    submitting: false,
  }
}

function createPortfolioDeleteState() {
  return {
    isOpen: false,
    targetId: null,
    submitting: false,
  }
}

export function useRoutePortfolioRuntime() {
  const { portfolioId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const routePortfolioId = String(portfolioId || OWNER_PORTFOLIO_ID).trim() || OWNER_PORTFOLIO_ID

  const initialMarketState = useMemo(() => readRouteMarketState(), [])
  const [marketPriceCache, setMarketPriceCache] = useState(initialMarketState.marketPriceCache)
  const [marketPriceSync, setMarketPriceSync] = useState(initialMarketState.marketPriceSync)
  const [lastUpdate, setLastUpdate] = useState(initialMarketState.lastUpdate)
  const [refreshing, setRefreshing] = useState(false)
  const { saved, flashSaved } = useSavedToast()
  const [cloudSync] = useState(false)
  const [showPortfolioManager, setShowPortfolioManager] = useState(false)
  const [portfolios, setPortfolios] = useState(() => readRuntimePortfolios())
  const [portfolioEditorState, setPortfolioEditorState] = useState(() =>
    createPortfolioEditorState()
  )
  const [portfolioDeleteState, setPortfolioDeleteState] = useState(() =>
    createPortfolioDeleteState()
  )
  const [routeData, setRouteData] = useState(() =>
    readPortfolioRuntimeSnapshot(routePortfolioId, {
      marketPriceCache: initialMarketState.marketPriceCache,
    })
  )
  const backupFileInputRef = useRef(null)

  const reloadRuntime = useCallback(
    (nextPortfolioId = routePortfolioId) => {
      const nextMarketState = readRouteMarketState()
      const nextPortfolios = readRuntimePortfolios()
      setMarketPriceCache(nextMarketState.marketPriceCache)
      setMarketPriceSync(nextMarketState.marketPriceSync)
      setLastUpdate(nextMarketState.lastUpdate)
      setPortfolios(nextPortfolios)
      setRouteData(
        readPortfolioRuntimeSnapshot(nextPortfolioId, {
          marketPriceCache: nextMarketState.marketPriceCache,
        })
      )
    },
    [routePortfolioId]
  )

  useEffect(() => {
    setPortfolios(readRuntimePortfolios())
    setRouteData(readPortfolioRuntimeSnapshot(routePortfolioId, { marketPriceCache }))
  }, [routePortfolioId, marketPriceCache])

  const persistRouteField = useCallback(
    (field, suffix, valueOrUpdater, normalize = (value) => value) => {
      const currentValue = routeData[field]
      const rawValue =
        typeof valueOrUpdater === 'function' ? valueOrUpdater(currentValue) : valueOrUpdater
      const nextValue = normalize(rawValue)
      setRouteData((prev) => ({ ...prev, [field]: nextValue }))
      void savePortfolioData(routePortfolioId, suffix, nextValue)
      return nextValue
    },
    [routeData, routePortfolioId]
  )

  const setHoldings = useCallback(
    (valueOrUpdater) =>
      persistRouteField('holdings', 'holdings-v2', valueOrUpdater, (value) =>
        normalizeHoldings(value, marketPriceCache?.prices)
      ),
    [persistRouteField, marketPriceCache]
  )

  const setWatchlist = useCallback(
    (valueOrUpdater) =>
      persistRouteField('watchlist', 'watchlist-v1', valueOrUpdater, normalizeWatchlist),
    [persistRouteField]
  )

  const setTargets = useCallback(
    (valueOrUpdater) =>
      persistRouteField('targets', 'targets-v1', valueOrUpdater, (value) =>
        value && typeof value === 'object' ? value : {}
      ),
    [persistRouteField]
  )

  const setFundamentals = useCallback(
    (valueOrUpdater) =>
      persistRouteField(
        'fundamentals',
        'fundamentals-v1',
        valueOrUpdater,
        normalizeFundamentalsStore
      ),
    [persistRouteField]
  )

  const setAnalystReports = useCallback(
    (valueOrUpdater) =>
      persistRouteField(
        'analystReports',
        'analyst-reports-v1',
        valueOrUpdater,
        normalizeAnalystReportsStore
      ),
    [persistRouteField]
  )

  const setHoldingDossiers = useCallback(
    (valueOrUpdater) =>
      persistRouteField(
        'holdingDossiers',
        'holding-dossiers-v1',
        valueOrUpdater,
        normalizeHoldingDossiers
      ),
    [persistRouteField]
  )

  const setNewsEvents = useCallback(
    (valueOrUpdater) =>
      persistRouteField('newsEvents', 'news-events-v1', valueOrUpdater, normalizeNewsEvents),
    [persistRouteField]
  )

  const setAnalysisHistory = useCallback(
    (valueOrUpdater) =>
      persistRouteField(
        'analysisHistory',
        'analysis-history-v1',
        valueOrUpdater,
        normalizeAnalysisHistoryEntries
      ),
    [persistRouteField]
  )

  const setDailyReport = useCallback(
    (valueOrUpdater) =>
      persistRouteField(
        'dailyReport',
        'daily-report-v1',
        valueOrUpdater,
        normalizeDailyReportEntry
      ),
    [persistRouteField]
  )

  const setResearchHistory = useCallback(
    (valueOrUpdater) =>
      persistRouteField('researchHistory', 'research-history-v1', valueOrUpdater, (value) =>
        Array.isArray(value) ? value : []
      ),
    [persistRouteField]
  )

  const setStrategyBrain = useCallback(
    (valueOrUpdater) =>
      persistRouteField('strategyBrain', 'brain-v1', valueOrUpdater, (value) =>
        normalizeStrategyBrain(value, { allowEmpty: true })
      ),
    [persistRouteField]
  )

  const setTradeLog = useCallback(
    (valueOrUpdater) =>
      persistRouteField('tradeLog', 'log-v2', valueOrUpdater, (value) =>
        Array.isArray(value) ? value : []
      ),
    [persistRouteField]
  )

  const setReversalConditions = useCallback(
    (valueOrUpdater) =>
      persistRouteField('reversalConditions', 'reversal-v1', valueOrUpdater, (value) =>
        value && typeof value === 'object' ? value : {}
      ),
    [persistRouteField]
  )

  const setPortfolioNotes = useCallback(
    (valueOrUpdater) =>
      persistRouteField('portfolioNotes', 'notes-v1', valueOrUpdater, normalizePortfolioNotes),
    [persistRouteField]
  )

  const updateTargetPrice = useCallback(
    (code, targetPrice) => {
      const numericTarget = targetPrice == null || targetPrice === '' ? null : Number(targetPrice)
      setTargets((prev) => ({
        ...(prev || {}),
        [code]: {
          ...((prev && prev[code]) || {}),
          targetPrice: Number.isFinite(numericTarget) ? numericTarget : null,
          updatedAt: new Date().toISOString(),
        },
      }))
      setHoldings((prev) =>
        (prev || []).map((holding) =>
          holding.code === code
            ? { ...holding, targetPrice: Number.isFinite(numericTarget) ? numericTarget : null }
            : holding
        )
      )
      return true
    },
    [setHoldings, setTargets]
  )

  const upsertTargetReport = useCallback(
    (entry) => {
      const code = String(entry?.code || '').trim()
      const target = Number(entry?.target)
      if (!code || !Number.isFinite(target) || target <= 0) return false
      updateTargetPrice(code, target)
      return true
    },
    [updateTargetPrice]
  )

  const upsertFundamentalsEntry = useCallback(
    (code, entry) => {
      const normalizedCode = String(code || '').trim()
      if (!normalizedCode) return false
      setFundamentals((prev) => ({
        ...(prev || {}),
        [normalizedCode]: {
          ...(prev?.[normalizedCode] || {}),
          ...entry,
          code: normalizedCode,
        },
      }))
      return true
    },
    [setFundamentals]
  )

  const updateAlert = useCallback(
    (code, alert) => {
      setHoldings((prev) =>
        (prev || []).map((holding) =>
          holding.code === code ? { ...holding, alert: String(alert || '') } : holding
        )
      )
    },
    [setHoldings]
  )
  const { updateReversal } = useTransientUiActions({
    setReversalConditions,
    flashSaved,
    toSlashDate,
  })
  const { upsertWatchlist, removeWatchlist } = useWatchlistActions({
    setWatchlist,
  })

  const updateEvent = useCallback(
    (eventId, updates) => {
      setNewsEvents((prev) =>
        (prev || []).map((event) => (event.id === eventId ? { ...event, ...updates } : event))
      )
    },
    [setNewsEvents]
  )

  const refreshPrices = useCallback(() => {
    setRefreshing(true)
    reloadRuntime()
    setRefreshing(false)
    flashSaved('✅ 已重讀本機收盤價快取')
  }, [flashSaved, reloadRuntime])

  const copyWeeklyReport = useCallback(async () => {
    const activePortfolio = portfolios.find((portfolio) => portfolio.id === routePortfolioId)
    const totalValue = routeData.holdings.reduce((sum, item) => sum + (item.value || 0), 0)
    const totalCost = routeData.holdings.reduce(
      (sum, item) => sum + (Number(item.cost) || 0) * (Number(item.qty) || 0),
      0
    )
    const totalPnl = totalValue - totalCost
    const retPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0
    const { todayAlertSummary } = buildHoldingAlertSummary(routeData.holdings)
    const text = buildClipboardReport({
      portfolioName: activePortfolio?.name || routePortfolioId,
      holdings: routeData.holdings,
      totalValue,
      totalPnl,
      retPct,
      todayAlertSummary,
    })

    try {
      await navigator.clipboard.writeText(text)
      flashSaved('✅ 週報摘要已複製')
    } catch (error) {
      console.error('copyWeeklyReport failed:', error)
      flashSaved('❌ 週報複製失敗')
    }
  }, [flashSaved, portfolios, routePortfolioId, routeData.holdings])

  const exportLocalBackup = useCallback(() => {
    downloadJson(`portfolio-backup-${routePortfolioId}-${toSlashDate().replace(/\//g, '-')}.json`, {
      exportedAt: new Date().toISOString(),
      storage: collectPortfolioBackupStorage(),
    })
    flashSaved('✅ 已匯出本機備份')
  }, [flashSaved, routePortfolioId])

  const importLocalBackup = useCallback(
    (event) => {
      const file = event?.target?.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = () => {
        try {
          const payload = JSON.parse(String(reader.result || '{}'))
          const normalized = normalizeBackupStorage(payload)
          if (!normalized) throw new Error('備份格式無法辨識')
          Object.entries(normalized).forEach(([key, value]) => {
            localStorage.setItem(key, JSON.stringify(value))
          })
          const nextPortfolios = normalizePortfolios(
            normalized[PORTFOLIOS_KEY] || readRuntimePortfolios()
          )
          if (!normalized[PORTFOLIOS_KEY]) {
            localStorage.setItem(PORTFOLIOS_KEY, JSON.stringify(nextPortfolios))
          }
          reloadRuntime()
          flashSaved('✅ 已匯入本機備份')
        } catch (error) {
          console.error('importLocalBackup failed:', error)
          flashSaved('❌ 匯入失敗')
        } finally {
          event.target.value = ''
        }
      }
      reader.readAsText(file)
    },
    [flashSaved, reloadRuntime]
  )

  const createPortfolio = useCallback(
    async (rawName) => {
      const name = String(rawName || '').trim()
      if (!name) return false

      const newPortfolio = {
        id: `p-${Date.now().toString(36)}`,
        name,
        isOwner: false,
        createdAt: new Date().toISOString().slice(0, 10),
      }
      const nextPortfolios = [...portfolios, newPortfolio]
      setPortfolios(nextPortfolios)
      await save(PORTFOLIOS_KEY, nextPortfolios)
      await Promise.all(
        PORTFOLIO_STORAGE_FIELDS.map((field) =>
          save(
            pfKey(newPortfolio.id, field.suffix),
            getPortfolioFallback(newPortfolio.id, field.suffix)
          )
        )
      )
      flashSaved(`✅ 已新增組合「${name}」`)
      navigate(buildPortfolioRoute(newPortfolio.id))
      return true
    },
    [flashSaved, navigate, portfolios]
  )

  const switchPortfolio = useCallback(
    (nextPortfolioId) => {
      if (!nextPortfolioId) return
      void save(ACTIVE_PORTFOLIO_KEY, nextPortfolioId)
      void save(VIEW_MODE_KEY, PORTFOLIO_VIEW_MODE)
      navigate(buildPortfolioRoute(nextPortfolioId))
    },
    [navigate]
  )

  const renamePortfolio = useCallback(
    async (pid, rawName) => {
      const current = portfolios.find((portfolio) => portfolio.id === pid)
      if (!current) return false
      const name = String(rawName || '').trim()
      if (!name || name === current.name) return false
      const nextPortfolios = portfolios.map((portfolio) =>
        portfolio.id === pid ? { ...portfolio, name } : portfolio
      )
      setPortfolios(nextPortfolios)
      await save(PORTFOLIOS_KEY, nextPortfolios)
      flashSaved(`✅ 已更新組合名稱為「${name}」`)
      return true
    },
    [flashSaved, portfolios]
  )

  const deletePortfolio = useCallback(
    async (pid) => {
      const current = portfolios.find((portfolio) => portfolio.id === pid)
      if (!current || pid === OWNER_PORTFOLIO_ID) return false

      PORTFOLIO_STORAGE_FIELDS.forEach((field) => {
        localStorage.removeItem(pfKey(pid, field.suffix))
      })

      const nextPortfolios = portfolios.filter((portfolio) => portfolio.id !== pid)
      setPortfolios(nextPortfolios)
      await save(PORTFOLIOS_KEY, nextPortfolios)
      flashSaved(`✅ 已刪除組合「${current.name}」`)

      if (routePortfolioId === pid) {
        navigate(buildPortfolioRoute(OWNER_PORTFOLIO_ID))
      }
      return true
    },
    [flashSaved, navigate, portfolios, routePortfolioId]
  )

  const openOverview = useCallback(() => {
    void save(VIEW_MODE_KEY, OVERVIEW_VIEW_MODE)
    navigate('/overview')
  }, [navigate])

  const exitOverview = useCallback(() => {
    void save(VIEW_MODE_KEY, PORTFOLIO_VIEW_MODE)
    navigate(buildPortfolioRoute(routePortfolioId))
  }, [navigate, routePortfolioId])

  const closePortfolioEditor = useCallback(() => {
    setPortfolioEditorState(createPortfolioEditorState())
  }, [])

  const openCreatePortfolio = useCallback(() => {
    setPortfolioEditorState({
      isOpen: true,
      mode: 'create',
      name: '',
      targetId: null,
      submitting: false,
    })
  }, [])

  const openRenamePortfolio = useCallback((portfolio) => {
    if (!portfolio?.id) return
    setPortfolioEditorState({
      isOpen: true,
      mode: 'rename',
      name: portfolio.name || '',
      targetId: portfolio.id,
      submitting: false,
    })
  }, [])

  const closePortfolioDeleteDialog = useCallback(() => {
    setPortfolioDeleteState(createPortfolioDeleteState())
  }, [])

  const openDeletePortfolio = useCallback((portfolio) => {
    if (!portfolio?.id || portfolio.id === OWNER_PORTFOLIO_ID) return
    setPortfolioDeleteState({
      isOpen: true,
      targetId: portfolio.id,
      submitting: false,
    })
  }, [])

  const submitPortfolioEditor = useCallback(async () => {
    const name = String(portfolioEditorState.name || '').trim()
    if (!name || portfolioEditorState.submitting) return false

    setPortfolioEditorState((prev) => ({ ...prev, submitting: true }))
    try {
      const success =
        portfolioEditorState.mode === 'rename'
          ? await renamePortfolio(portfolioEditorState.targetId, name)
          : await createPortfolio(name)
      if (success) {
        closePortfolioEditor()
      } else {
        setPortfolioEditorState((prev) => ({ ...prev, submitting: false }))
      }
      return success
    } catch (error) {
      console.error('submitPortfolioEditor failed:', error)
      setPortfolioEditorState((prev) => ({ ...prev, submitting: false }))
      return false
    }
  }, [
    closePortfolioEditor,
    createPortfolio,
    portfolioEditorState.mode,
    portfolioEditorState.name,
    portfolioEditorState.submitting,
    portfolioEditorState.targetId,
    renamePortfolio,
  ])

  const submitPortfolioDelete = useCallback(async () => {
    if (!portfolioDeleteState.targetId || portfolioDeleteState.submitting) return false

    setPortfolioDeleteState((prev) => ({ ...prev, submitting: true }))
    try {
      const success = await deletePortfolio(portfolioDeleteState.targetId)
      if (success) {
        closePortfolioDeleteDialog()
      } else {
        setPortfolioDeleteState((prev) => ({ ...prev, submitting: false }))
      }
      return success
    } catch (error) {
      console.error('submitPortfolioDelete failed:', error)
      setPortfolioDeleteState((prev) => ({ ...prev, submitting: false }))
      return false
    }
  }, [
    closePortfolioDeleteDialog,
    deletePortfolio,
    portfolioDeleteState.submitting,
    portfolioDeleteState.targetId,
  ])

  const portfolioSummaries = useMemo(
    () => buildPortfolioSummariesFromStorage({ portfolios, marketPriceCache }),
    [marketPriceCache, portfolios]
  )
  const totalValue = routeData.holdings.reduce((sum, item) => sum + (item.value || 0), 0)
  const totalCost = routeData.holdings.reduce(
    (sum, item) => sum + (Number(item.cost) || 0) * (Number(item.qty) || 0),
    0
  )
  const displayedTotalPnl = totalValue - totalCost
  const displayedRetPct = totalCost > 0 ? (displayedTotalPnl / totalCost) * 100 : 0
  const { urgentCount, todayAlertSummary } = buildHoldingAlertSummary(routeData.holdings)
  const tabs = buildPortfolioTabs({ urgentCount })
  const overviewTotalValue = portfolioSummaries.reduce(
    (sum, portfolio) => sum + portfolio.totalValue,
    0
  )
  const tab = location.pathname.split('/').filter(Boolean).pop() || 'holdings'
  const activePortfolioId = routePortfolioId

  const priceSyncStatusTone =
    marketPriceSync?.status === 'failed'
      ? C.up
      : marketPriceSync?.status === 'partial'
        ? C.amber
        : marketPriceSync?.status === 'success'
          ? C.olive
          : C.textMute
  const priceSyncStatusLabel =
    marketPriceSync?.status === 'failed'
      ? '同步失敗'
      : marketPriceSync?.status === 'partial'
        ? '部分成功'
        : marketPriceSync?.status === 'success'
          ? '已同步'
          : '未同步'

  const outletContext = useMemo(
    () => ({
      portfolioId: routePortfolioId,
      ...routeData,
      setHoldings,
      setWatchlist,
      setTargets,
      setFundamentals,
      setAnalystReports,
      setHoldingDossiers,
      setNewsEvents,
      setAnalysisHistory,
      setDailyReport,
      setResearchHistory,
      setStrategyBrain,
      setTradeLog,
      setReversalConditions,
      setPortfolioNotes,
      updateTargetPrice,
      upsertTargetReport,
      upsertFundamentalsEntry,
      updateAlert,
      updateReversal,
      upsertWatchlist,
      removeWatchlist,
      updateEvent,
      refreshPrices,
      reloadRuntime,
      flashSaved,
      createDefaultReviewForm,
      createDefaultFundamentalDraft,
      applyTradeEntryToHoldings,
    }),
    [
      routePortfolioId,
      routeData,
      setHoldings,
      setWatchlist,
      setTargets,
      setFundamentals,
      setAnalystReports,
      setHoldingDossiers,
      setNewsEvents,
      setAnalysisHistory,
      setDailyReport,
      setResearchHistory,
      setStrategyBrain,
      setTradeLog,
      setReversalConditions,
      setPortfolioNotes,
      updateTargetPrice,
      upsertTargetReport,
      upsertFundamentalsEntry,
      updateAlert,
      updateReversal,
      upsertWatchlist,
      removeWatchlist,
      updateEvent,
      refreshPrices,
      reloadRuntime,
      flashSaved,
    ]
  )

  const headerProps = useMemo(
    () => ({
      C,
      cloudSync,
      saved,
      refreshPrices,
      refreshing,
      copyWeeklyReport,
      exportLocalBackup,
      backupFileInputRef,
      importLocalBackup,
      priceSyncStatusTone,
      priceSyncStatusLabel,
      activePriceSyncAt: marketPriceSync?.syncedAt ? new Date(marketPriceSync.syncedAt) : null,
      lastUpdate,
      pc: (value) => (value >= 0 ? C.up : C.down),
      displayedTotalPnl,
      displayedRetPct,
      activePortfolioId,
      switchPortfolio,
      ready: true,
      portfolioSwitching: false,
      portfolioSummaries,
      createPortfolio,
      viewMode: PORTFOLIO_VIEW_MODE,
      exitOverview,
      openOverview,
      showPortfolioManager,
      setShowPortfolioManager,
      renamePortfolio,
      deletePortfolio,
      OWNER_PORTFOLIO_ID,
      overviewTotalValue,
      portfolioNotes: routeData.portfolioNotes,
      setPortfolioNotes,
      PORTFOLIO_VIEW_MODE,
      OVERVIEW_VIEW_MODE,
      urgentCount,
      todayAlertSummary,
      TABS: tabs,
      tab,
      setTab: (nextTab) => navigate(buildPortfolioRoute(routePortfolioId, nextTab)),
      portfolioEditor: {
        ...portfolioEditorState,
        setName: (name) => setPortfolioEditorState((prev) => ({ ...prev, name })),
        close: closePortfolioEditor,
        submit: submitPortfolioEditor,
        openCreate: openCreatePortfolio,
        openRename: openRenamePortfolio,
        targetPortfolio:
          portfolios.find((portfolio) => portfolio.id === portfolioEditorState.targetId) || null,
      },
      portfolioDeleteDialog: {
        ...portfolioDeleteState,
        close: closePortfolioDeleteDialog,
        submit: submitPortfolioDelete,
        open: openDeletePortfolio,
        targetPortfolio:
          portfolios.find((portfolio) => portfolio.id === portfolioDeleteState.targetId) || null,
      },
    }),
    [
      cloudSync,
      saved,
      refreshPrices,
      refreshing,
      copyWeeklyReport,
      exportLocalBackup,
      backupFileInputRef,
      importLocalBackup,
      priceSyncStatusTone,
      priceSyncStatusLabel,
      marketPriceSync,
      lastUpdate,
      displayedTotalPnl,
      displayedRetPct,
      activePortfolioId,
      switchPortfolio,
      portfolioSummaries,
      createPortfolio,
      exitOverview,
      openOverview,
      showPortfolioManager,
      setShowPortfolioManager,
      renamePortfolio,
      deletePortfolio,
      overviewTotalValue,
      routeData.portfolioNotes,
      setPortfolioNotes,
      urgentCount,
      todayAlertSummary,
      tabs,
      tab,
      navigate,
      routePortfolioId,
      closePortfolioEditor,
      closePortfolioDeleteDialog,
      openDeletePortfolio,
      openCreatePortfolio,
      openRenamePortfolio,
      portfolioDeleteState,
      portfolioEditorState,
      portfolios,
      submitPortfolioDelete,
      submitPortfolioEditor,
    ]
  )

  return {
    headerProps,
    outletContext,
  }
}
