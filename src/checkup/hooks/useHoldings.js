/**
 * Holdings Hook
 *
 * Manages holdings state, calculations, and CRUD operations.
 */

import { useState, useCallback, useMemo } from 'react'
import {
  normalizeHoldings,
  applyTradeEntryToHoldings,
  applyMarketQuotesToHoldings,
  getPortfolioValue,
  getPortfolioCost,
  getPortfolioPnl,
  getPortfolioReturnPct,
  sortHoldingsByPnl,
  sortHoldingsByReturn,
  getHoldingsWithAlerts,
  getHoldingsMissingPrices,
} from '../lib/holdings.js'

/**
 * Holdings Hook
 *
 * @param {Object} params
 * @param {Array} params.initialHoldings - Initial holdings array
 * @param {Object} params.marketQuotes - Current market quotes
 * @returns {Object} Holdings state and operations
 */
export const useHoldings = ({ initialHoldings = [], marketQuotes = null } = {}) => {
  const [holdings, setHoldings] = useState(() => normalizeHoldings(initialHoldings, marketQuotes))
  const [watchlist, setWatchlist] = useState([])
  const [targets, setTargets] = useState({})
  const [fundamentals, setFundamentals] = useState({})
  const [analystReports, setAnalystReports] = useState({})
  const [holdingDossiers, setHoldingDossiers] = useState([])
  const [reversalConditions, setReversalConditions] = useState({})

  /**
   * Update holdings
   */
  const updateHoldings = useCallback(
    async (pid, suffix, data) => {
      if (suffix !== 'holdings-v2') return
      const normalized = normalizeHoldings(data, marketQuotes)
      setHoldings(normalized)
    },
    [marketQuotes]
  )

  /**
   * Add or update a holding
   */
  const upsertHolding = useCallback(
    (holdingData) => {
      if (!holdingData || !holdingData.code) return

      setHoldings((prev) => {
        const normalized = normalizeHoldings([holdingData], marketQuotes)[0]
        if (!normalized) return prev

        const idx = prev.findIndex((h) => h.code === holdingData.code)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = normalized
          return next
        }
        return [...prev, normalized]
      })
    },
    [marketQuotes]
  )

  /**
   * Remove a holding
   */
  const removeHolding = useCallback((code) => {
    if (!code) return
    setHoldings((prev) => prev.filter((h) => h.code !== code))
  }, [])

  /**
   * Apply trade entry to holdings
   */
  const applyTrade = useCallback(
    (trade) => {
      if (!trade || !trade.code || !trade.action) return

      setHoldings((prev) => applyTradeEntryToHoldings(prev, trade, marketQuotes))
    },
    [marketQuotes]
  )

  /**
   * Update holding target price
   */
  const updateTargetPrice = useCallback((code, targetPrice) => {
    if (!code) return

    setHoldings((prev) => prev.map((h) => (h.code === code ? { ...h, targetPrice } : h)))

    setTargets((prev) => ({
      ...prev,
      [code]: { targetPrice, updatedAt: new Date().toISOString() },
    }))
  }, [])

  /**
   * Update holding alert
   */
  const updateAlert = useCallback((code, alert) => {
    if (!code) return

    setHoldings((prev) => prev.map((h) => (h.code === code ? { ...h, alert } : h)))
  }, [])

  /**
   * Refresh holdings prices with new quotes
   */
  const refreshPrices = useCallback((newQuotes) => {
    setHoldings((prev) => applyMarketQuotesToHoldings(prev, newQuotes))
  }, [])

  /**
   * Get holding by code
   */
  const getHolding = useCallback(
    (code) => {
      return holdings.find((h) => h.code === code) || null
    },
    [holdings]
  )

  /**
   * Holdings summary metrics
   */
  const holdingsSummary = useMemo(() => {
    const totalValue = getPortfolioValue(holdings)
    const totalCost = getPortfolioCost(holdings)
    const totalPnl = getPortfolioPnl(holdings)
    const totalRetPct = getPortfolioReturnPct(holdings)

    return {
      totalValue,
      totalCost,
      totalPnl,
      totalRetPct,
      count: holdings.length,
    }
  }, [holdings])

  /**
   * Top gainers
   */
  const topGainers = useMemo(() => {
    return sortHoldingsByReturn(holdings, 'desc').slice(0, 5)
  }, [holdings])

  /**
   * Top losers
   */
  const topLosers = useMemo(() => {
    return sortHoldingsByReturn(holdings, 'asc').slice(0, 5)
  }, [holdings])

  /**
   * Holdings with alerts
   */
  const holdingsWithAlerts = useMemo(() => {
    return getHoldingsWithAlerts(holdings)
  }, [holdings])

  /**
   * Holdings missing prices
   */
  const holdingsMissingPrices = useMemo(() => {
    return getHoldingsMissingPrices(holdings)
  }, [holdings])

  /**
   * Holdings by P&L
   */
  const holdingsByPnl = useMemo(() => {
    return sortHoldingsByPnl(holdings, 'desc')
  }, [holdings])

  return {
    // State
    holdings,
    watchlist,
    targets,
    fundamentals,
    analystReports,
    holdingDossiers,
    reversalConditions,

    // Summary
    holdingsSummary,
    topGainers,
    topLosers,
    holdingsWithAlerts,
    holdingsMissingPrices,
    holdingsByPnl,

    // Operations
    updateHoldings,
    upsertHolding,
    removeHolding,
    applyTrade,
    updateTargetPrice,
    updateAlert,
    refreshPrices,
    getHolding,

    // Setters
    setHoldings,
    setWatchlist,
    setTargets,
    setFundamentals,
    setAnalystReports,
    setHoldingDossiers,
    setReversalConditions,

    // Helpers
    normalizeHoldings,
    applyMarketQuotesToHoldings,
    applyTradeEntryToHoldings,
  }
}
