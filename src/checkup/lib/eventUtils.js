import { CLOSED_EVENT_STATUSES, DEFAULT_REVIEW_FORM, EVENT_HISTORY_LIMIT } from '../constants.js'
import { STOCK_META } from '../seedData.js'
import { normalizeBrainEvidenceRefs } from './brainRuntime.js'

export function createDefaultReviewForm(overrides = {}) {
  return { ...DEFAULT_REVIEW_FORM, ...overrides }
}

export function isClosedEvent(event) {
  return CLOSED_EVENT_STATUSES.has(event?.status)
}

export function toSlashDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}/${month}/${day}`
}

export function parseSlashDate(value) {
  const match = String(value || '')
    .trim()
    .match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  )
    return null
  date.setHours(0, 0, 0, 0)
  return date
}

export function parseFlexibleDate(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value)
  if (typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const raw = String(value).trim()
  if (!raw) return null
  const slashDate = parseSlashDate(raw)
  if (slashDate) return slashDate
  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoDate) {
    const date = new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]))
    return Number.isNaN(date.getTime()) ? null : date
  }
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function getEventStockCodes(event) {
  return Array.from(
    new Set(
      (event?.stocks || [])
        .map((stock) => String(stock).match(/\d{4,6}[A-Z]?L?/i)?.[0] || null)
        .filter(Boolean)
    )
  )
}

export function normalizePriceRecord(value, event) {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    const codes = getEventStockCodes(event)
    return codes.length === 1 ? { [codes[0]]: value } : null
  }
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value)
    .map(([code, price]) => [code, Number(price)])
    .filter(([, price]) => Number.isFinite(price) && price > 0)
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

export function normalizePriceHistory(value, event) {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const date = typeof entry.date === 'string' ? entry.date : null
      const prices = normalizePriceRecord(entry.prices, event)
      if (!date || !prices) return null
      return { date, prices }
    })
    .filter(Boolean)
    .slice(-EVENT_HISTORY_LIMIT)
}

export function parseEventStockDescriptor(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const code = String(value.code || '').trim()
    const name = String(value.name || '').trim() || STOCK_META[code]?.name || code
    return code ? { code, name } : null
  }
  const raw = String(value || '').trim()
  if (!raw) return null
  const code = raw.match(/\d{4,6}[A-Z]?L?/i)?.[0] || ''
  if (!code) return null
  const stripped = raw
    .replace(code, ' ')
    .replace(/[()（）-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return {
    code,
    name: stripped || STOCK_META[code]?.name || code,
  }
}

export function buildEventStockDescriptors(event) {
  return (Array.isArray(event?.stocks) ? event.stocks : [])
    .map(parseEventStockDescriptor)
    .filter(Boolean)
}

export function averagePriceRecord(value) {
  const prices = Object.values(value || {})
    .map(Number)
    .filter((price) => Number.isFinite(price) && price > 0)
  if (prices.length === 0) return null
  return prices.reduce((sum, price) => sum + price, 0) / prices.length
}

export function inferEventActual(priceAtEvent, priceAtExit, weights = null) {
  if (weights && typeof weights === 'object' && !Array.isArray(weights)) {
    const codes = Object.keys(priceAtEvent || {}).filter(
      (code) => Object.keys(priceAtExit || {}).includes(code) && Object.keys(weights).includes(code)
    )
    if (codes.length > 0) {
      const totalWeight = codes.reduce((sum, code) => sum + (weights[code] || 0), 0)
      if (totalWeight > 0) {
        let weightedEntry = 0
        let weightedExit = 0
        codes.forEach((code) => {
          const weight = (weights[code] || 0) / totalWeight
          weightedEntry += (priceAtEvent[code] || 0) * weight
          weightedExit += (priceAtExit[code] || 0) * weight
        })
        if (weightedEntry > 0 && weightedExit > 0) {
          const pct = (weightedExit / weightedEntry - 1) * 100
          if (Math.abs(pct) <= 1) return 'neutral'
          return pct > 0 ? 'up' : 'down'
        }
      }
    }
  }

  const entryAvg = averagePriceRecord(priceAtEvent)
  const exitAvg = averagePriceRecord(priceAtExit)
  if (!entryAvg || !exitAvg) return null
  const pct = (exitAvg / entryAvg - 1) * 100
  if (Math.abs(pct) <= 1) return 'neutral'
  return pct > 0 ? 'up' : 'down'
}

export function appendPriceHistory(history, date, prices) {
  const next = Array.isArray(history) ? [...history] : []
  const idx = next.findIndex((item) => item?.date === date)
  const record = { date, prices }
  if (idx >= 0) next[idx] = record
  else next.push(record)
  return next.slice(-EVENT_HISTORY_LIMIT)
}

export function normalizeEventOutcomeLabel(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  return ['supported', 'contradicted', 'mixed', 'inconclusive'].includes(normalized)
    ? normalized
    : 'inconclusive'
}

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

export function buildEventStockOutcomes(event) {
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
        ? `${name} 事件價 ${entryPrice.toFixed(1)} -> 結案 ${exitPrice.toFixed(1)}（${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%）`
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
  return `${outcome.name || outcome.code}：${actualLabel}${pct}｜${verdict}`
}

/**
 * Infer catalyst type from event title text
 * @returns {'earnings'|'corporate'|'industry'|'macro'|'technical'|null}
 */
export function inferCatalystType(event) {
  const text = (event?.title || '').toLowerCase()
  if (!text) return null
  if (/營收|財報|eps|法說|季報|年報/.test(text)) return 'earnings'
  if (/併購|增資|庫藏|董事|除權|除息/.test(text)) return 'corporate'
  if (/產能|訂單|供應鏈|技術|製程/.test(text)) return 'industry'
  if (/fed|利率|gdp|cpi|央行|匯率|關稅/.test(text)) return 'macro'
  if (/外資|融資|融券|成交量|突破|跌破/.test(text)) return 'technical'
  return null
}

/**
 * Infer impact level from catalyst type
 * @returns {'high'|'medium'|'low'|null}
 */
export function inferImpact(event) {
  const type = event?.catalystType
  if (!type) return null
  if (type === 'earnings') return 'high'
  if (type === 'technical') return 'low'
  return 'medium'
}

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
  const catalystType = event.catalystType || inferCatalystType(event)
  const impact = event.impact || inferImpact({ catalystType })

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
    // Catalyst fields (backward compatible)
    catalystType: catalystType || null,
    impact: impact || null,
    relatedThesisIds: Array.isArray(event.relatedThesisIds) ? event.relatedThesisIds : [],
    pillarImpact: event.pillarImpact || null,
  }
}

export function normalizeNewsEvents(items) {
  return (Array.isArray(items) ? items : []).map(normalizeEventRecord).filter(Boolean)
}

export function buildEventReviewEvidenceRefs(event, reviewDate = toSlashDate()) {
  const refId = String(event?.id || '').trim()
  const label = event?.title ? `事件復盤：${event.title}` : '事件復盤'
  const codes = buildEventStockDescriptors(event).map((item) => item.code)
  const refs = (codes.length > 0 ? codes : ['']).map((code) => ({
    type: 'review',
    refId,
    code,
    label,
    date: reviewDate,
  }))
  return normalizeBrainEvidenceRefs(refs)
}
