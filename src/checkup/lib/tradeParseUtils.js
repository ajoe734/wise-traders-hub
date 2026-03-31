import { toSlashDate } from './eventUtils.js'

function normalizeTradeDate(value, fallbackDate = toSlashDate()) {
  const raw = String(value || '').trim()
  if (!raw) return fallbackDate

  const slashMatch = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/)
  if (slashMatch) {
    const [, year, month, day] = slashMatch
    return `${year}/${month}/${day}`
  }

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return fallbackDate
  return toSlashDate(parsed)
}

function normalizeTradeTime(value, fallbackTime) {
  const raw = String(value || '').trim()
  if (!raw) return fallbackTime
  return raw
}

function normalizeTradeAction(value) {
  const raw = String(value || '').trim()
  if (raw === '賣出') return '賣出'
  return '買進'
}

function normalizeTradeNumeric(value) {
  const normalized = Number(
    String(value ?? '')
      .replace(/,/g, '')
      .trim()
  )
  return Number.isFinite(normalized) ? normalized : 0
}

function normalizeTradeRow(row, fallbackDate) {
  if (!row || typeof row !== 'object') return null

  const code = String(row.code || '').trim()
  const name = String(row.name || '').trim()
  if (!code && !name) return null

  return {
    action: normalizeTradeAction(row.action),
    code,
    name,
    qty: normalizeTradeNumeric(row.qty),
    price: normalizeTradeNumeric(row.price),
    amount: row.amount == null ? null : normalizeTradeNumeric(row.amount),
    date: normalizeTradeDate(row.date || row.tradeDate, fallbackDate),
    time: String(row.time || '').trim(),
  }
}

function normalizeTargetPriceUpdate(update) {
  if (!update || typeof update !== 'object') return null
  const code = String(update.code || '').trim()
  const firm = String(update.firm || '').trim()
  const target = normalizeTradeNumeric(update.target)
  if (!code || !firm || !Number.isFinite(target) || target <= 0) return null

  return {
    code,
    firm,
    target,
    date: normalizeTradeDate(update.date, toSlashDate()),
  }
}

export function normalizeTradeParseResult(raw, fallbackDate = toSlashDate()) {
  const tradeDate = normalizeTradeDate(raw?.tradeDate, fallbackDate)
  const trades = Array.isArray(raw?.trades)
    ? raw.trades.map((row) => normalizeTradeRow(row, tradeDate)).filter(Boolean)
    : []
  const targetPriceUpdates = Array.isArray(raw?.targetPriceUpdates)
    ? raw.targetPriceUpdates.map(normalizeTargetPriceUpdate).filter(Boolean)
    : []

  return {
    tradeDate,
    trades,
    targetPriceUpdates,
    note: String(raw?.note || '').trim(),
    confidence: String(raw?.confidence || '').trim() || 'unknown',
  }
}

export function getTradeBatchMode(trades = []) {
  const actions = new Set(
    (Array.isArray(trades) ? trades : [])
      .map((trade) => String(trade?.action || '').trim())
      .filter(Boolean)
  )

  if (actions.size === 1) return Array.from(actions)[0]
  if (actions.size > 1) return '混合'
  return '買進'
}

export function buildTradeLogEntries({
  parsed,
  tradeDate = toSlashDate(),
  memoQuestions = [],
  memoAnswers = [],
  now = new Date(),
}) {
  const fallbackTime = now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
  const trades = Array.isArray(parsed?.trades) ? parsed.trades : []

  return trades.map((trade, index) => ({
    id: Number(`${now.getTime()}${index}`),
    date: normalizeTradeDate(trade.date || tradeDate, tradeDate),
    time: normalizeTradeTime(trade.time, fallbackTime),
    action: normalizeTradeAction(trade.action),
    code: String(trade.code || '').trim(),
    name: String(trade.name || '').trim(),
    qty: normalizeTradeNumeric(trade.qty),
    price: normalizeTradeNumeric(trade.price),
    qa: memoQuestions.map((question, questionIndex) => ({
      q: question,
      a: memoAnswers[questionIndex] || '',
    })),
  }))
}

export function applyParsedTradesToHoldings({
  holdings = [],
  parsed,
  applyTradeEntryToHoldings,
  marketQuotes = null,
}) {
  const trades = Array.isArray(parsed?.trades) ? parsed.trades : []
  return trades.reduce(
    (rows, trade) => applyTradeEntryToHoldings(rows, trade, marketQuotes),
    Array.isArray(holdings) ? holdings : []
  )
}

export function summarizeTradeBatch(parsed) {
  const trades = Array.isArray(parsed?.trades) ? parsed.trades : []
  const summary = trades.reduce(
    (acc, trade) => {
      const notional = Number(trade.amount) || (Number(trade.qty) || 0) * (Number(trade.price) || 0)
      if (trade.action === '賣出') acc.sellCount += 1
      else acc.buyCount += 1
      acc.tradeCount += 1
      acc.totalNotional += notional
      if (trade.code) acc.codes.add(trade.code)
      return acc
    },
    {
      tradeCount: 0,
      buyCount: 0,
      sellCount: 0,
      totalNotional: 0,
      codes: new Set(),
    }
  )

  return {
    tradeCount: summary.tradeCount,
    buyCount: summary.buyCount,
    sellCount: summary.sellCount,
    totalNotional: summary.totalNotional,
    codes: Array.from(summary.codes),
    targetUpdateCount: Array.isArray(parsed?.targetPriceUpdates)
      ? parsed.targetPriceUpdates.length
      : 0,
  }
}

export function assessTradeParseQuality(parsed) {
  const confidence = String(parsed?.confidence || 'unknown').trim() || 'unknown'
  const note = String(parsed?.note || '').trim()
  const trades = Array.isArray(parsed?.trades) ? parsed.trades : []
  const rowWarnings = trades
    .map((trade, index) => {
      const issues = []
      if (!String(trade.code || '').trim()) issues.push('代碼缺失')
      if (!String(trade.name || '').trim()) issues.push('名稱缺失')
      if ((Number(trade.qty) || 0) <= 0) issues.push('股數異常')
      if ((Number(trade.price) || 0) <= 0) issues.push('成交價異常')
      return issues.length > 0
        ? {
            index,
            code: String(trade.code || '').trim(),
            name: String(trade.name || '').trim(),
            issues,
          }
        : null
    })
    .filter(Boolean)

  const issues = []
  if (confidence === 'low') issues.push('模型自評為低信心，建議逐筆檢查。')
  if (confidence === 'medium') issues.push('模型自評為中等信心，建議至少核對代碼、股數與成交價。')
  if (note) issues.push(`模型備註：${note}`)
  if (rowWarnings.length > 0) issues.push(`有 ${rowWarnings.length} 筆交易欄位不完整或數值異常。`)

  return {
    confidence,
    note,
    rowWarnings,
    issues,
    needsManualReview: issues.length > 0,
  }
}
