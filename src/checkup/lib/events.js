/**
 * Event tracking utilities
 *
 * Handles event normalization, status transitions, and review workflows.
 */

import { EVENT_HISTORY_LIMIT, CLOSED_EVENT_STATUSES } from '../constants.js'

// ── Event status helpers ──────────────────────────────────────────────

/**
 * Check if an event is closed
 */
export function isClosedEvent(event) {
  if (!event || typeof event !== 'object') return false
  return CLOSED_EVENT_STATUSES.has(event.status)
}

/**
 * Normalize event outcome label
 */
export function normalizeEventOutcomeLabel(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  return ['supported', 'contradicted', 'mixed', 'inconclusive'].includes(normalized)
    ? normalized
    : 'inconclusive'
}

/**
 * Infer event actual outcome from price data
 */
export function inferEventActual(priceAtEvent, priceAtExit) {
  if (!priceAtEvent || !priceAtExit) return null
  const entryAvg = averagePriceRecord(priceAtEvent)
  const exitAvg = averagePriceRecord(priceAtExit)
  if (!entryAvg || !exitAvg) return null
  const pct = (exitAvg / entryAvg - 1) * 100
  if (Math.abs(pct) <= 1) return 'neutral'
  return pct > 0 ? 'up' : 'down'
}

/**
 * Calculate average price from a price record
 */
export function averagePriceRecord(priceRecord) {
  if (!priceRecord || typeof priceRecord !== 'object') return null
  const values = Object.values(priceRecord).filter(
    (v) => Number.isFinite(Number(v)) && Number(v) > 0
  )
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + Number(v), 0) / values.length
}

/**
 * Infer event stock outcomes for multi-stock events
 */
export function inferEventStockOutcomes(priceAtEvent, priceAtExit) {
  if (!priceAtEvent || !priceAtExit) return []
  const codes = new Set([...Object.keys(priceAtEvent), ...Object.keys(priceAtExit)])
  return Array.from(codes).map((code) => {
    const entry = priceAtEvent[code]
    const exit = priceAtExit[code]
    if (!entry || !exit) return { code, outcome: 'inconclusive', changePct: null }
    const pct = (exit / entry - 1) * 100
    let outcome = 'inconclusive'
    if (Math.abs(pct) <= 1) outcome = 'neutral'
    else outcome = pct > 0 ? 'up' : 'down'
    return { code, outcome, changePct: Math.round(pct * 100) / 100 }
  })
}

/**
 * Append price history record
 */
export function appendPriceHistory(history, date, prices) {
  const next = Array.isArray(history) ? [...history] : []
  const idx = next.findIndex((item) => item?.date === date)
  const record = { date, prices }
  if (idx >= 0) next[idx] = record
  else next.push(record)
  return next.slice(-EVENT_HISTORY_LIMIT)
}

/**
 * Normalize price record
 */
export function normalizePriceRecord(value, _event) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const normalized = {}
  for (const [code, price] of Object.entries(value)) {
    const num = Number(price)
    if (Number.isFinite(num) && num > 0) {
      normalized[code] = num
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : null
}

/**
 * Normalize price history
 */
export function normalizePriceHistory(value, event) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const date = String(item.date || '').trim() || null
      const prices = normalizePriceRecord(item.prices, event)
      if (!date || !prices) return null
      return { date, prices }
    })
    .filter(Boolean)
    .slice(-EVENT_HISTORY_LIMIT)
}

/**
 * Parse event stock descriptor
 */
export function parseEventStockDescriptor(value) {
  if (!value || typeof value !== 'object') return null
  const code = String(value.code || '').trim()
  const name = String(value.name || '').trim()
  if (!code) return null
  return { code, name: name || code }
}

/**
 * Build event stock descriptors from stocks field
 */
export function buildEventStockDescriptors(event) {
  if (!event || typeof event !== 'object') return []
  const stocks = String(event.stocks || '').trim()
  if (!stocks) return []

  return stocks
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const match = s.match(/^(\d{4,6})\s*(.*)$/)
      if (match) {
        return { code: match[1], name: match[2] || match[1] }
      }
      return { code: s, name: s }
    })
}

/**
 * Normalize event stock outcome
 */
export function normalizeEventStockOutcome(value, event) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const descriptor =
    parseEventStockDescriptor(value) ||
    parseEventStockDescriptor({ code: value.code, name: value.name })
  const code = descriptor?.code || ''
  if (!code) return null

  const predicted = ['up', 'down', 'neutral'].includes(value.predicted)
    ? value.predicted
    : ['up', 'down', 'neutral'].includes(event?.pred)
      ? event.pred
      : null

  const actual = ['up', 'down', 'neutral'].includes(value.actual)
    ? value.actual
    : inferEventActual(
        Number.isFinite(Number(value.priceAtEvent))
          ? { [code]: Number(value.priceAtEvent) }
          : event?.priceAtEvent,
        Number.isFinite(Number(value.priceAtExit))
          ? { [code]: Number(value.priceAtExit) }
          : event?.priceAtExit
      )

  const priceAtEvent = Number(value.priceAtEvent)
  const priceAtExit = Number(value.priceAtExit)
  const changePct = Number(value.changePct)
  const thesisHeld = typeof value.thesisHeld === 'boolean' ? value.thesisHeld : null

  return {
    code,
    name: descriptor?.name || code,
    predicted,
    actual: actual || null,
    priceAtEvent: Number.isFinite(priceAtEvent) && priceAtEvent > 0 ? priceAtEvent : null,
    priceAtExit: Number.isFinite(priceAtExit) && priceAtExit > 0 ? priceAtExit : null,
    changePct: Number.isFinite(changePct) ? Math.round(changePct * 100) / 100 : null,
    thesisHeld,
    outcomeLabel: normalizeEventOutcomeLabel(value.outcomeLabel),
    note: String(value.note || '').trim(),
  }
}

/**
 * Build event stock outcomes array
 */
export function buildEventStockOutcomes(event) {
  if (!event || typeof event !== 'object') return []

  const descriptors = buildEventStockDescriptors(event)
  if (descriptors.length === 0) return []

  return descriptors
    .map(({ code, name }) => {
      const entryPrice = Number(event?.priceAtEvent?.[code])
      const exitPrice = Number(event?.priceAtExit?.[code])
      const actual =
        inferEventActual(
          Number.isFinite(entryPrice) && entryPrice > 0 ? { [code]: entryPrice } : null,
          Number.isFinite(exitPrice) && exitPrice > 0 ? { [code]: exitPrice } : null
        ) ||
        (descriptors.length === 1 && ['up', 'down', 'neutral'].includes(event?.actual)
          ? event.actual
          : null)

      const changePct =
        Number.isFinite(entryPrice) && entryPrice > 0 && Number.isFinite(exitPrice) && exitPrice > 0
          ? (exitPrice / entryPrice - 1) * 100
          : null

      const predicted = ['up', 'down', 'neutral'].includes(event?.pred) ? event.pred : null
      let outcomeLabel = 'inconclusive'

      if (predicted && actual) {
        if (predicted === actual) outcomeLabel = 'supported'
        else if (actual === 'neutral' || predicted === 'neutral') outcomeLabel = 'mixed'
        else outcomeLabel = 'contradicted'
      }

      const thesisHeld =
        outcomeLabel === 'supported' ? true : outcomeLabel === 'contradicted' ? false : null

      const autoNote = Number.isFinite(changePct)
        ? `${name} 事件價 ${entryPrice.toFixed(1)} → 結案 ${exitPrice.toFixed(1)}（${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%）`
        : event?.actualNote || ''

      return normalizeEventStockOutcome(
        {
          code,
          name,
          predicted,
          actual,
          priceAtEvent: entryPrice,
          priceAtExit: exitPrice,
          changePct,
          thesisHeld,
          outcomeLabel,
          note: autoNote,
        },
        event
      )
    })
    .filter(Boolean)
}

/**
 * Format event stock outcome as a line of text
 */
export function formatEventStockOutcomeLine(outcome) {
  if (!outcome) return ''
  const actualLabel =
    outcome.actual === 'up'
      ? '上漲'
      : outcome.actual === 'down'
        ? '下跌'
        : outcome.actual === 'neutral'
          ? '中性'
          : '未明'
  const verdict =
    outcome.outcomeLabel === 'supported'
      ? '支持原判斷'
      : outcome.outcomeLabel === 'contradicted'
        ? '與原判斷相反'
        : outcome.outcomeLabel === 'mixed'
          ? '部分支持'
          : '暫無定論'
  const pct = Number.isFinite(Number(outcome.changePct))
    ? `（${Number(outcome.changePct) >= 0 ? '+' : ''}${Number(outcome.changePct).toFixed(1)}%）`
    : ''
  return `${outcome.name}：${actualLabel}${pct} · ${verdict}`
}

/**
 * Normalize event record
 */
export function normalizeEventRecord(event) {
  if (!event || typeof event !== 'object') return null

  const status =
    event.status === 'tracking' ? 'tracking' : isClosedEvent(event) ? 'closed' : 'pending'
  const priceAtEvent = normalizePriceRecord(event.priceAtEvent, event)
  const priceAtExit = normalizePriceRecord(event.priceAtExit, event)
  const reviewDate = event.reviewDate || null

  const eventDate =
    event.eventDate || (status === 'closed' ? event.date || reviewDate || null : null)
  const trackingStart = event.trackingStart || eventDate || null
  const exitDate = event.exitDate || (status === 'closed' ? reviewDate || null : null)

  const actual = ['up', 'down', 'neutral'].includes(event.actual)
    ? event.actual
    : inferEventActual(priceAtEvent, priceAtExit)

  const stockOutcomes =
    Array.isArray(event.stockOutcomes) && event.stockOutcomes.length > 0
      ? event.stockOutcomes.map((item) => normalizeEventStockOutcome(item, event)).filter(Boolean)
      : status === 'closed'
        ? buildEventStockOutcomes({ ...event, priceAtEvent, priceAtExit, actual })
        : []

  return {
    ...event,
    status,
    stocks: buildEventStockDescriptors(event).map((item) => `${item.name} ${item.code}`),
    eventDate,
    trackingStart,
    exitDate,
    priceAtEvent,
    priceAtExit,
    priceHistory: normalizePriceHistory(event.priceHistory, event),
    actual: actual || null,
    actualNote: event.actualNote || '',
    stockOutcomes,
    correct: typeof event.correct === 'boolean' ? event.correct : null,
    lessons: event.lessons || '',
    reviewDate,
  }
}

/**
 * Normalize multiple news events
 */
export function normalizeNewsEvents(items) {
  return (Array.isArray(items) ? items : []).map(normalizeEventRecord).filter(Boolean)
}

/**
 * Transition event to a new status
 */
export function transitionEventStatus(event, newStatus, updates = {}) {
  if (!event || typeof event !== 'object') return null

  const normalized = normalizeEventRecord(event)
  if (!normalized) return null

  const next = { ...normalized, ...updates }

  if (newStatus === 'tracking' && normalized.status === 'pending') {
    next.status = 'tracking'
    next.trackingStart = updates.trackingStart || normalized.eventDate || todayStorageDate()
  }

  if (newStatus === 'closed' && normalized.status !== 'closed') {
    next.status = 'closed'
    next.exitDate = updates.exitDate || todayStorageDate()
    next.reviewDate = updates.reviewDate || todayStorageDate()
  }

  return normalizeEventRecord(next)
}

/**
 * Get today's date as storage string
 */
function todayStorageDate() {
  return new Date().toISOString().slice(0, 10)
}
