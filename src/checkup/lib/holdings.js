/**
 * Holdings management utilities
 *
 * This module handles all holdings-related calculations and normalizations.
 * It's designed to be pure and testable, with no side effects.
 */

import {
  calculateHoldingCostBasis,
  calculateHoldingMarketValue,
  calculateHoldingReturnPct,
  calculateHoldingUnrealizedPnl,
} from './holdingMath.ts'

// ── Price resolution ─────────────────────────────────────────────────────

/**
 * Resolve the current price for a holding.
 * Priority: overridePrice > stored price > derived from value/qty
 */
export function resolveHoldingPrice(item, overridePrice = null) {
  if (!item || typeof item !== 'object') return 0

  // Priority 1: Override price (from API quotes)
  if (overridePrice != null) {
    const candidate = Number(overridePrice)
    if (Number.isFinite(candidate) && candidate > 0) return candidate
  }

  // Priority 2: Stored price
  const storedPrice = Number(item?.price)
  if (Number.isFinite(storedPrice) && storedPrice > 0) return storedPrice

  // Priority 3: Derive from value / qty
  const qty = Number(item?.qty) || 0
  const storedValue = Number(item?.value)
  if (qty > 0 && Number.isFinite(storedValue) && storedValue > 0) {
    return storedValue / qty
  }

  return 0
}

// ── Metrics calculation ──────────────────────────────────────────────────

/**
 * Get cost basis for a holding
 */
export function getHoldingCostBasis(item) {
  if (!item || typeof item !== 'object') return 0
  return calculateHoldingCostBasis(item?.cost, item?.qty)
}

/**
 * Get market value for a holding
 */
export function getHoldingMarketValue(item, overridePrice = null) {
  if (!item || typeof item !== 'object') return 0
  const price = resolveHoldingPrice(item, overridePrice)
  return calculateHoldingMarketValue(price, item?.qty)
}

/**
 * Get unrealized P&L for a holding
 */
export function getHoldingUnrealizedPnl(item, overridePrice = null) {
  if (!item || typeof item !== 'object') return 0

  // Use pre-calculated pnl if available
  if (typeof item.pnl === 'number') return item.pnl

  const price = resolveHoldingPrice(item, overridePrice)
  return calculateHoldingUnrealizedPnl(price, item?.qty, item?.cost)
}

/**
 * Get return percentage for a holding
 */
export function getHoldingReturnPct(item, overridePrice = null) {
  if (!item || typeof item !== 'object') return 0

  // Use pre-calculated pct if available
  if (typeof item.pct === 'number') return item.pct

  const price = resolveHoldingPrice(item, overridePrice)
  return calculateHoldingReturnPct(price, item?.qty, item?.cost)
}

/**
 * Normalize holding metrics (price, value, pnl, pct)
 */
export function normalizeHoldingMetrics(item, overridePrice = null) {
  if (!item || typeof item !== 'object') return item

  const price = resolveHoldingPrice(item, overridePrice)
  const qty = Number(item?.qty) || 0
  const cost = Number(item?.cost) || 0

  const value = calculateHoldingMarketValue(price, qty)
  const pnl = calculateHoldingUnrealizedPnl(price, qty, cost)
  const pct = calculateHoldingReturnPct(price, qty, cost)

  return {
    ...item,
    price,
    value: Math.round(value),
    pnl: Math.round(pnl),
    pct: Math.round(pct * 100) / 100,
  }
}

/**
 * Normalize a single holding row with integrity checks
 */
export function normalizeHoldingRow(item, overridePrice = null) {
  if (!item || typeof item !== 'object') return null

  const code = String(item.code || '').trim()
  if (!code) return null

  const qty = Number(item.qty) || 0
  const cost = Number(item.cost) || 0
  const targetPrice = Number(item.targetPrice)

  const normalized = normalizeHoldingMetrics(
    {
      ...item,
      code,
      name: String(item.name || code).trim() || code,
      qty,
      cost,
      type: item.type || '股票',
      alert: item.alert || '',
      expire: item.expire || null,
    },
    overridePrice
  )

  return {
    ...normalized,
    targetPrice: Number.isFinite(targetPrice) ? targetPrice : null,
    integrityIssue: qty > 0 && normalized.price <= 0 ? 'missing-price' : null,
  }
}

/**
 * Normalize multiple holdings with optional quotes and price hints
 */
export function normalizeHoldings(rows, quotes = null, priceHints = null) {
  const priceQuotes = quotes && typeof quotes === 'object' ? quotes : null
  const hintMap = priceHints && typeof priceHints === 'object' ? priceHints : null

  return (Array.isArray(rows) ? rows : [])
    .map((item) =>
      normalizeHoldingRow(
        item,
        priceQuotes?.[item?.code]?.price || hintMap?.[String(item?.code || '').trim()] || null
      )
    )
    .filter(Boolean)
}

/**
 * Apply market quotes to holdings
 */
export function applyMarketQuotesToHoldings(rows, quotes) {
  return normalizeHoldings(rows, quotes)
}

/**
 * Apply a trade entry to holdings (buy/sell)
 */
export function applyTradeEntryToHoldings(rows, trade, quotes = null) {
  if (!trade || !trade.code || !trade.action) {
    return normalizeHoldings(rows, quotes)
  }

  const arr = [...(Array.isArray(rows) ? rows : [])]
  const idx = arr.findIndex((h) => h.code === trade.code)
  const qty = Number(trade.qty) || 0
  const price = Number(trade.price) || 0

  if (trade.action === '買進') {
    if (idx >= 0) {
      const h = arr[idx]
      const nq = (Number(h.qty) || 0) + qty
      if (nq === 0) return normalizeHoldings(arr, quotes)

      const cost = Number(h.cost) || 0
      const nc = (cost * (Number(h.qty) || 0) + price * qty) / nq

      arr[idx] = {
        ...h,
        qty: nq,
        price,
        cost: Math.round(nc * 100) / 100,
      }
    } else {
      arr.push({
        code: trade.code,
        name: trade.name,
        qty,
        price,
        cost: price,
        type: '股票',
      })
    }
    return normalizeHoldings(arr, quotes)
  }

  // Sell action
  if (idx >= 0) {
    const h = arr[idx]
    const currentQty = Number(h.qty) || 0
    const nq = Math.max(0, currentQty - qty)

    if (nq === 0) {
      arr.splice(idx, 1)
    } else {
      arr[idx] = {
        ...h,
        qty: nq,
        price,
      }
    }
  }

  return normalizeHoldings(arr, quotes)
}

/**
 * Determine if cloud holdings should replace local holdings
 */
export function shouldAdoptCloudHoldings(localRows, cloudRows) {
  const local = Array.isArray(localRows) ? localRows : []
  const cloud = Array.isArray(cloudRows) ? cloudRows : []

  if (cloud.length === 0) return false
  if (local.length === 0) return true

  const localByCode = new Map(local.map((item) => [String(item?.code || '').trim(), item]))

  for (const cloudItem of cloud) {
    const code = String(cloudItem?.code || '').trim()
    if (!code) continue

    const localItem = localByCode.get(code)
    if (!localItem) return true
    if ((Number(localItem?.qty) || 0) !== (Number(cloudItem?.qty) || 0)) return true
    if ((Number(localItem?.cost) || 0) !== (Number(cloudItem?.cost) || 0)) return true
  }

  return false
}

/**
 * Build price hints from analysis history
 */
export function buildHoldingPriceHints({ analysisHistory = [], fallbackRows = [] } = {}) {
  const hints = {}

  // From analysis history
  ;(Array.isArray(analysisHistory) ? analysisHistory : []).forEach((report) => {
    ;(Array.isArray(report?.changes) ? report.changes : []).forEach((change) => {
      const code = String(change?.code || '').trim()
      const price = Number(change?.price)
      if (!code || !Number.isFinite(price) || price <= 0 || hints[code]) return
      hints[code] = price
    })
  })

  // From fallback rows
  ;(Array.isArray(fallbackRows) ? fallbackRows : []).forEach((row) => {
    const code = String(row?.code || '').trim()
    const price = Number(row?.price)
    if (!code || !Number.isFinite(price) || price <= 0 || hints[code]) return
    hints[code] = price
  })

  return hints
}

// ── Aggregation helpers ──────────────────────────────────────────────────

/**
 * Calculate total portfolio value
 */
export function getPortfolioValue(holdings, overridePrice = null) {
  if (!Array.isArray(holdings)) return 0
  return holdings.reduce((sum, item) => sum + getHoldingMarketValue(item, overridePrice), 0)
}

/**
 * Calculate total portfolio cost
 */
export function getPortfolioCost(holdings) {
  if (!Array.isArray(holdings)) return 0
  return holdings.reduce((sum, item) => sum + getHoldingCostBasis(item), 0)
}

/**
 * Calculate total portfolio P&L
 */
export function getPortfolioPnl(holdings, overridePrice = null) {
  if (!Array.isArray(holdings)) return 0
  return holdings.reduce((sum, item) => sum + getHoldingUnrealizedPnl(item, overridePrice), 0)
}

/**
 * Calculate portfolio return percentage
 */
export function getPortfolioReturnPct(holdings, overridePrice = null) {
  if (!Array.isArray(holdings)) return 0
  const cost = getPortfolioCost(holdings)
  if (cost <= 0) return 0
  const pnl = getPortfolioPnl(holdings, overridePrice)
  return (pnl / cost) * 100
}

/**
 * Get holdings grouped by type
 */
export function groupHoldingsByType(holdings) {
  if (!Array.isArray(holdings)) return {}
  return holdings.reduce((acc, item) => {
    const type = item.type || '股票'
    if (!acc[type]) acc[type] = []
    acc[type].push(item)
    return acc
  }, {})
}

/**
 * Sort holdings by P&L
 */
export function sortHoldingsByPnl(holdings, direction = 'desc') {
  if (!Array.isArray(holdings)) return []
  return [...holdings].sort((a, b) => {
    const aPnl = Number(a?.pnl) || 0
    const bPnl = Number(b?.pnl) || 0
    return direction === 'desc' ? bPnl - aPnl : aPnl - bPnl
  })
}

/**
 * Sort holdings by return percentage
 */
export function sortHoldingsByReturn(holdings, direction = 'desc') {
  if (!Array.isArray(holdings)) return []
  return [...holdings].sort((a, b) => {
    const aPct = Number(a?.pct) || 0
    const bPct = Number(b?.pct) || 0
    return direction === 'desc' ? bPct - aPct : aPct - bPct
  })
}

/**
 * Filter holdings with alerts
 */
export function getHoldingsWithAlerts(holdings) {
  if (!Array.isArray(holdings)) return []
  return holdings.filter((item) => item.alert && item.alert.trim() !== '')
}

/**
 * Get holdings missing prices
 */
export function getHoldingsMissingPrices(holdings) {
  if (!Array.isArray(holdings)) return []
  return holdings.filter((item) => item.integrityIssue === 'missing-price')
}
