import { useState, useMemo, useCallback, useRef } from 'react'
import {
  OWNER_PORTFOLIO_ID,
  OVERVIEW_VIEW_MODE,
  PORTFOLIOS_KEY,
  ACTIVE_PORTFOLIO_KEY,
  STATUS_MESSAGE_TIMEOUT_MS,
  VIEW_MODE_KEY,
  PORTFOLIO_STORAGE_FIELDS,
  PORTFOLIO_SUFFIX_TO_FIELD,
  PORTFOLIO_VIEW_MODE,
} from '../constants.js'
import {
  todayStorageDate,
  pfKey,
  save,
  getHoldingCostBasis,
  getHoldingMarketValue,
  applyMarketQuotesToHoldings,
  clonePortfolioNotes,
  normalizeNewsEvents,
} from '../utils.js'

/**
 * Read a value from localStorage
 */
function readStorageValue(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/**
 * Get fallback value for a portfolio field
 */
function getPortfolioFallback(pid, suffix) {
  const field = PORTFOLIO_SUFFIX_TO_FIELD[suffix]
  if (!field) return null
  return (pid === OWNER_PORTFOLIO_ID ? field.ownerFallback : field.emptyFallback)()
}

/**
 * Remove all data for a portfolio
 */
function removePortfolioData(pid) {
  for (const field of PORTFOLIO_STORAGE_FIELDS) {
    try {
      localStorage.removeItem(pfKey(pid, field.suffix))
    } catch {
      /* best-effort local cleanup */
    }
  }
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

/**
 * Portfolio Management Hook
 *
 * Manages portfolio state, switching, creation, renaming, and deletion.
 * Also handles overview mode toggling.
 */
export const usePortfolioManagement = ({
  ready: _ready = false,
  initialPortfolios = [],
  initialActivePortfolioId = OWNER_PORTFOLIO_ID,
  initialViewMode = PORTFOLIO_VIEW_MODE,
  activeHoldings = [],
  activeNewsEvents = [],
  activePortfolioNotes = {},
  marketPriceCache = null,
  flushCurrentPortfolio = async () => {},
  resetTransientUiState = () => {},
  loadPortfolio = async () => {},
  setSaved = () => {},
  notifySaved = null,
} = {}) => {
  const [portfolios, setPortfolios] = useState(initialPortfolios)
  const [activePortfolioId, setActivePortfolioId] = useState(initialActivePortfolioId)
  const [viewMode, setViewMode] = useState(initialViewMode)
  const [portfolioSwitching, setPortfolioSwitching] = useState(false)
  const [showPortfolioManager, setShowPortfolioManager] = useState(false)
  const [portfolioEditorState, setPortfolioEditorState] = useState(() =>
    createPortfolioEditorState()
  )
  const [portfolioDeleteState, setPortfolioDeleteState] = useState(() =>
    createPortfolioDeleteState()
  )

  const portfolioTransitionRef = useRef({
    isHydrating: false,
    fromPid: initialActivePortfolioId,
    toPid: initialActivePortfolioId,
  })

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

  /**
   * Get snapshot of a portfolio's data
   */
  const getPortfolioSnapshot = useCallback(
    (portfolioId) => {
      const useLiveState = viewMode === PORTFOLIO_VIEW_MODE && portfolioId === activePortfolioId
      const holdingsValue = useLiveState
        ? activeHoldings
        : readStorageValue(pfKey(portfolioId, 'holdings-v2'))
      const eventsValue = useLiveState
        ? activeNewsEvents
        : readStorageValue(pfKey(portfolioId, 'news-events-v1'))
      const notesValue = useLiveState
        ? activePortfolioNotes
        : readStorageValue(pfKey(portfolioId, 'notes-v1'))

      return {
        holdings: applyMarketQuotesToHoldings(
          Array.isArray(holdingsValue)
            ? holdingsValue
            : getPortfolioFallback(portfolioId, 'holdings-v2'),
          marketPriceCache?.prices
        ),
        newsEvents: normalizeNewsEvents(
          Array.isArray(eventsValue)
            ? eventsValue
            : getPortfolioFallback(portfolioId, 'news-events-v1')
        ),
        notes:
          notesValue && typeof notesValue === 'object'
            ? { ...clonePortfolioNotes(), ...notesValue }
            : clonePortfolioNotes(),
      }
    },
    [
      viewMode,
      activePortfolioId,
      activeHoldings,
      activeNewsEvents,
      activePortfolioNotes,
      marketPriceCache,
    ]
  )

  /**
   * Calculate portfolio summaries with metrics
   */
  const portfolioSummaries = useMemo(() => {
    if (!portfolios) return []
    return portfolios.map((portfolio) => {
      const snapshot = getPortfolioSnapshot(portfolio.id)
      const rows = snapshot.holdings
      const holdingCount = Array.isArray(rows) ? rows.length : 0
      const portfolioValue = (rows || []).reduce(
        (sum, item) => sum + getHoldingMarketValue(item),
        0
      )
      const portfolioCost = (rows || []).reduce((sum, item) => sum + getHoldingCostBasis(item), 0)
      const portfolioPnl = portfolioValue - portfolioCost
      const portfolioRetPct = portfolioCost > 0 ? (portfolioPnl / portfolioCost) * 100 : 0
      return {
        ...portfolio,
        holdingCount,
        totalValue: portfolioValue,
        totalPnl: portfolioPnl,
        retPct: portfolioRetPct,
      }
    })
  }, [portfolios, getPortfolioSnapshot])

  /**
   * Switch to a different portfolio
   */
  const switchPortfolio = useCallback(
    async (pid) => {
      if (!pid || portfolioSwitching) return
      if (pid === activePortfolioId && viewMode === PORTFOLIO_VIEW_MODE) return

      setPortfolioSwitching(true)
      portfolioTransitionRef.current = { isHydrating: true, fromPid: activePortfolioId, toPid: pid }

      try {
        await flushCurrentPortfolio()
        resetTransientUiState()
        await save(VIEW_MODE_KEY, PORTFOLIO_VIEW_MODE)
        await save(ACTIVE_PORTFOLIO_KEY, pid)
        await loadPortfolio(pid, PORTFOLIO_VIEW_MODE)
      } catch (err) {
        console.error('組合切換失敗:', err)
        emitSaved('❌ 組合切換失敗')
      } finally {
        portfolioTransitionRef.current = { isHydrating: false, fromPid: pid, toPid: pid }
        setPortfolioSwitching(false)
      }
    },
    [
      activePortfolioId,
      viewMode,
      portfolioSwitching,
      flushCurrentPortfolio,
      resetTransientUiState,
      loadPortfolio,
      emitSaved,
    ]
  )

  /**
   * Create a new portfolio
   */
  const createPortfolio = useCallback(
    async (rawName) => {
      const name = String(rawName || '').trim()
      if (!name) return false

      const newPf = {
        id: `p-${Date.now().toString(36)}`,
        name,
        isOwner: false,
        createdAt: todayStorageDate(),
      }
      const nextPortfolios = [...portfolios, newPf]

      setPortfolios(nextPortfolios)
      await save(PORTFOLIOS_KEY, nextPortfolios)
      await Promise.all(
        PORTFOLIO_STORAGE_FIELDS.map((field) =>
          save(pfKey(newPf.id, field.suffix), getPortfolioFallback(newPf.id, field.suffix))
        )
      )
      await switchPortfolio(newPf.id)
      emitSaved(`✅ 已新增組合「${name}」`)
      return true
    },
    [emitSaved, portfolios, switchPortfolio]
  )

  /**
   * Rename a portfolio
   */
  const renamePortfolio = useCallback(
    async (pid, rawName) => {
      const current = portfolios.find((item) => item.id === pid)
      if (!current) return false
      const name = String(rawName || '').trim()
      if (!name || name === current.name) return false

      const nextPortfolios = portfolios.map((item) => (item.id === pid ? { ...item, name } : item))
      setPortfolios(nextPortfolios)
      await save(PORTFOLIOS_KEY, nextPortfolios)
      emitSaved(`✅ 已更新組合名稱為「${name}」`)
      return true
    },
    [emitSaved, portfolios]
  )

  /**
   * Delete a portfolio
   */
  const deletePortfolio = useCallback(
    async (pid) => {
      const current = portfolios.find((item) => item.id === pid)
      if (!current || pid === OWNER_PORTFOLIO_ID) return false

      let nextPid = activePortfolioId
      setPortfolioSwitching(true)
      portfolioTransitionRef.current = {
        isHydrating: true,
        fromPid: activePortfolioId,
        toPid: activePortfolioId,
      }

      try {
        if (viewMode === PORTFOLIO_VIEW_MODE && pid === activePortfolioId) {
          await flushCurrentPortfolio(pid)
        }

        removePortfolioData(pid)
        const nextPortfolios = portfolios.filter((item) => item.id !== pid)
        nextPid = nextPortfolios.some((item) => item.id === OWNER_PORTFOLIO_ID)
          ? OWNER_PORTFOLIO_ID
          : nextPortfolios[0]?.id || OWNER_PORTFOLIO_ID

        setPortfolios(nextPortfolios)
        await save(PORTFOLIOS_KEY, nextPortfolios)

        if (pid === activePortfolioId) {
          await switchPortfolio(nextPid)
        }

        emitSaved(`✅ 已刪除組合「${current.name}」`)
        return true
      } catch (err) {
        console.error('刪除組合失敗:', err)
        emitSaved('❌ 刪除組合失敗')
        return false
      } finally {
        portfolioTransitionRef.current = { isHydrating: false, fromPid: nextPid, toPid: nextPid }
        setPortfolioSwitching(false)
      }
    },
    [portfolios, activePortfolioId, viewMode, flushCurrentPortfolio, switchPortfolio, emitSaved]
  )

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

  /**
   * Enter overview mode (read-only view of all portfolios)
   */
  const openOverview = useCallback(async () => {
    if (portfolioSwitching || viewMode === OVERVIEW_VIEW_MODE) return
    setPortfolioSwitching(true)
    portfolioTransitionRef.current = {
      isHydrating: true,
      fromPid: activePortfolioId,
      toPid: activePortfolioId,
    }
    try {
      await flushCurrentPortfolio()
      resetTransientUiState()
      setViewMode(OVERVIEW_VIEW_MODE)
      await save(VIEW_MODE_KEY, OVERVIEW_VIEW_MODE)
    } finally {
      portfolioTransitionRef.current = {
        isHydrating: false,
        fromPid: activePortfolioId,
        toPid: activePortfolioId,
      }
      setPortfolioSwitching(false)
    }
  }, [
    activePortfolioId,
    flushCurrentPortfolio,
    portfolioSwitching,
    resetTransientUiState,
    viewMode,
  ])

  /**
   * Exit overview mode and return to portfolio view
   */
  const exitOverview = useCallback(async () => {
    if (portfolioSwitching || viewMode !== OVERVIEW_VIEW_MODE) return
    await switchPortfolio(activePortfolioId)
  }, [activePortfolioId, portfolioSwitching, switchPortfolio, viewMode])

  return {
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
    switchPortfolio,
    openOverview,
    exitOverview,
  }
}
