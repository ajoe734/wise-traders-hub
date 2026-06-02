/**
 * Holdings management utilities
 *
 * This module handles all holdings-related calculations and normalizations.
 * It's designed to be pure and testable, with no side effects.
 *
 * H6（audit 2026-06）：所有 pnl/pct/value 計算必經 holdingMath.ts；本檔禁止
 * 出現 `(price-cost)*qty` 字面 pattern（由 scripts/check-holdings-formula-singleton.mjs CI 守門）。
 */

import {
  calculateHoldingCostBasis,
  calculateHoldingMarketValue,
  calculateHoldingReturnPct,
  calculateHoldingUnrealizedPnl,
  calcPnlWithNet,
  calcRemainingCostAfterPartialSell,
  calcWeightedAvgCost,
  toSafeNumber,
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
 * Get unrealized P&L for a holding.
 * H6: 優先用 calcPnlWithNet（精確模式 / 統一公式入口），徹底消滅散落的 (price-cost)*qty。
 */
export function getHoldingUnrealizedPnl(item, overridePrice = null) {
  if (!item || typeof item !== 'object') return 0

  // Use pre-calculated pnl if available
  if (typeof item.pnl === 'number' && Number.isFinite(item.pnl)) return item.pnl

  const price = resolveHoldingPrice(item, overridePrice)
  const { pnl } = calcPnlWithNet(
    { qty: item.qty, cost: item.cost, totalCost: item.totalCost, fee: item.fee, code: item.code },
    price
  )
  return pnl
}

/**
 * Get return percentage for a holding
 * H7: 透過 calcPnlWithNet 統一處理 cost=0 / Infinity 防護。
 */
export function getHoldingReturnPct(item, overridePrice = null) {
  if (!item || typeof item !== 'object') return 0

  // Use pre-calculated pct if available
  if (typeof item.pct === 'number' && Number.isFinite(item.pct)) return item.pct

  const price = resolveHoldingPrice(item, overridePrice)
  const { pct } = calcPnlWithNet(
    { qty: item.qty, cost: item.cost, totalCost: item.totalCost, fee: item.fee, code: item.code },
    price
  )
  return pct
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
      const currentQty = toSafeNumber(h.qty)
      const nq = currentQty + qty
      if (nq === 0) return normalizeHoldings(arr, quotes)

      // H6/H8: 走 calcWeightedAvgCost 統一入口
      const nc = calcWeightedAvgCost(toSafeNumber(h.cost), currentQty, price, qty)

      // 加碼同步累加 totalCost / fee（精確模式才有意義；無則保持 null）
      const addCost = price * qty
      const newTotalCost = h.totalCost != null ? toSafeNumber(h.totalCost) + addCost : null
      const newFee = h.fee != null ? toSafeNumber(h.fee) + toSafeNumber(trade.fee) : null

      arr[idx] = {
        ...h,
        qty: nq,
        price,
        cost: Math.round(nc * 100) / 100,
        totalCost: newTotalCost,
        fee: newFee,
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

  // Sell action — H8: 部分賣出需按比例縮減 totalCost / fee，否則平均成本失真
  if (idx >= 0) {
    const h = arr[idx]
    const currentQty = toSafeNumber(h.qty)
    const nq = Math.max(0, currentQty - qty)

    if (nq === 0) {
      arr.splice(idx, 1)
    } else {
      const { newTotalCost, newFee } = calcRemainingCostAfterPartialSell(
        h.totalCost != null ? toSafeNumber(h.totalCost) : null,
        h.fee != null ? toSafeNumber(h.fee) : null,
        nq,
        currentQty
      )
      arr[idx] = {
        ...h,
        qty: nq,
        price,
        totalCost: newTotalCost,
        fee: newFee,
      }
    }
  }

  return normalizeHoldings(arr, quotes)
}

/**
 * Determine if cloud holdings should replace local holdings
 *
 * C9 (audit 2026-06)：比對欄位除了 qty/cost 外，必須包含 alert 與 targetPrice，
 * 否則使用者在 A 裝置設了目標價/警示，B 裝置雲端同步進來時會被判定「無差異」而忽略。
 */
export function shouldAdoptCloudHoldings(localRows, cloudRows) {
  const local = Array.isArray(localRows) ? localRows : []
  const cloud = Array.isArray(cloudRows) ? cloudRows : []

  if (cloud.length === 0) return false
  if (local.length === 0) return true

  const localByCode = new Map(local.map((item) => [String(item?.code || '').trim(), item]))

  const normAlert = (v) => (v == null ? '' : String(v))
  const normTarget = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  for (const cloudItem of cloud) {
    const code = String(cloudItem?.code || '').trim()
    if (!code) continue

    const localItem = localByCode.get(code)
    if (!localItem) return true
    if ((Number(localItem?.qty) || 0) !== (Number(cloudItem?.qty) || 0)) return true
    if ((Number(localItem?.cost) || 0) !== (Number(cloudItem?.cost) || 0)) return true
    if (normAlert(localItem?.alert) !== normAlert(cloudItem?.alert)) return true
    if (normTarget(localItem?.targetPrice) !== normTarget(cloudItem?.targetPrice)) return true
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
 * H2 (audit 2026-06): 用 toSafeNumber 而非 `Number() || 0`，避免 pnl=0 被當缺值
 */
export function sortHoldingsByPnl(holdings, direction = 'desc') {
  if (!Array.isArray(holdings)) return []
  return [...holdings].sort((a, b) => {
    const aPnl = toSafeNumber(a?.pnl)
    const bPnl = toSafeNumber(b?.pnl)
    return direction === 'desc' ? bPnl - aPnl : aPnl - bPnl
  })
}

/**
 * Sort holdings by return percentage
 * H2 (audit 2026-06): pct=0 必須與 pct=null 區分（後者排到尾端）
 */
export function sortHoldingsByReturn(holdings, direction = 'desc') {
  if (!Array.isArray(holdings)) return []
  return [...holdings].sort((a, b) => {
    const aPct = a?.pct == null ? null : toSafeNumber(a.pct, null)
    const bPct = b?.pct == null ? null : toSafeNumber(b.pct, null)
    // null 永遠排到尾端
    if (aPct == null && bPct == null) return 0
    if (aPct == null) return 1
    if (bPct == null) return -1
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
