// ── Phase 0-2: 資料收集與風險管理工具 ─────────────────────────────

/**
 * Calculate days between two dates
 */
export function daysBetween(date1, date2) {
  const oneDay = 24 * 60 * 60 * 1000
  return Math.round(Math.abs((date1 - date2) / oneDay))
}

/**
 * Calculate data freshness
 * @param {string|Date} dataDate - The date of the data
 * @param {Date} referenceDate - The reference date (default: now)
 * @returns {{ label: string, days: number, weight: number }}
 */
export function calculateFreshness(dataDate, referenceDate = new Date()) {
  const data = new Date(dataDate)
  const days = daysBetween(data, referenceDate)

  if (days <= 7) return { label: 'fresh', days, weight: 1.0 }
  if (days <= 30) return { label: 'aging', days, weight: 0.7 }
  if (days <= 90) return { label: 'stale', days, weight: 0.4 }
  return { label: 'expired', days, weight: 0.1 }
}

/**
 * Calculate data completeness score
 * @param {Object} stock - Stock data object
 * @returns {{ score: number, available: string[], missing: string[] }}
 */
export function calculateDataCompleteness(stock) {
  const fields = [
    'revenueYoY',
    'revenueMoM',
    'eps',
    'grossMargin',
    'targetPrice',
    'conferenceDate',
    'institutionalTrading',
  ]

  const available = fields.filter((f) => stock[f] !== null && stock[f] !== undefined)
  return {
    score: available.length / fields.length,
    available,
    missing: fields.filter((f) => !available.includes(f)),
  }
}

/**
 * Reconcile data from multiple sources
 * @param {Object} sources - Data from different sources
 * @param {string} fieldName - Field to reconcile
 * @returns {any} Reconciled value or warning object
 */
export function reconcileData(sources, fieldName) {
  const SOURCE_PRIORITY = {
    mops: 1,
    twse: 2,
    company: 3,
    news: 4,
    user: 5,
  }

  const values = Object.entries(sources)
    .filter(([_, data]) => data[fieldName] !== undefined)
    .map(([source, data]) => ({
      source,
      value: data[fieldName],
      priority: SOURCE_PRIORITY[source],
    }))

  if (values.length === 0) return null
  if (values.length === 1) return values[0].value

  values.sort((a, b) => a.priority - b.priority)
  const primary = values[0].value

  const variance =
    values.reduce((acc, v) => {
      return acc + Math.abs(v.value - primary) / primary
    }, 0) / values.length

  if (variance > 0.1) {
    return {
      value: primary,
      warning: `數據來源差異大 (${Math.round(variance * 100)}%)，請手動確認`,
      sources: values,
    }
  }

  return primary
}

/**
 * Format number for prompt (save tokens)
 */
export function formatPromptNumber(value, digits = 1) {
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return digits === 0 ? String(Math.round(num)) : num.toFixed(digits)
}

/**
 * Summarize fundamentals for prompt
 */
export function summarizeFundamentals(fundamentals) {
  if (!fundamentals) return '無數據'

  const parts = [
    fundamentals.revenueYoY ? `YoY ${formatPromptNumber(fundamentals.revenueYoY, 1)}%` : null,
    fundamentals.eps ? `EPS ${formatPromptNumber(fundamentals.eps, 2)}` : null,
    fundamentals.grossMargin ? `毛利率 ${formatPromptNumber(fundamentals.grossMargin, 1)}%` : null,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(' | ') : '無數據'
}

/**
 * Build temporal context for AI prompt
 */
export function buildTemporalContext(data) {
  const lines = []

  if (data.price?.date) {
    const freshness = calculateFreshness(data.price.date)
    lines.push(`股價 ${data.price.value} (${freshness.days}天前，${freshness.label})`)
  }

  if (data.revenue?.date) {
    const freshness = calculateFreshness(data.revenue.date)
    lines.push(`營收 ${data.revenue.value} (${freshness.days}天前，${freshness.label})`)
  }

  if (data.targetPrice?.date) {
    const freshness = calculateFreshness(data.targetPrice.date)
    lines.push(`目標價 ${data.targetPrice.value} (${freshness.days}天前，${freshness.label})`)
  }

  if (lines.length === 0) return ''

  return `\n數據時間脈絡：\n${lines.join('\n')}`
}

/**
 * Check if data is stale and needs refresh
 */
export function isDataStale(timestamp, ttl) {
  return Date.now() - timestamp > ttl
}

/**
 * Get cached data with TTL check
 */
export function getCachedData(key, ttl) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null

    const cached = JSON.parse(raw)
    if (isDataStale(cached.timestamp, ttl)) {
      localStorage.removeItem(key)
      return null
    }

    return cached.data
  } catch {
    return null
  }
}

/**
 * Set cached data with timestamp
 */
export function setCachedData(key, data) {
  try {
    const cached = {
      data,
      timestamp: Date.now(),
    }
    localStorage.setItem(key, JSON.stringify(cached))
  } catch (err) {
    console.error('Failed to cache data:', err)
  }
}

/**
 * Compress data for AI prompt (save tokens)
 */
export function compressDataForPrompt(data, options = {}) {
  const { maxItems = 5 } = options

  const essential = {
    code: data.code,
    name: data.name,
    price: data.price,
    changePercent: data.changePercent,
  }

  if (data.holdings?.length > maxItems) {
    const total = data.holdings.length
    const topHoldings = data.holdings.slice(0, maxItems)
    const topValue = topHoldings.reduce((sum, h) => sum + h.value, 0)
    const totalValue = data.holdings.reduce((sum, h) => sum + h.value, 0)
    essential.holdingsSummary = `共${total}檔，前${maxItems}檔占${Math.round((topValue / totalValue) * 100)}%`
  } else {
    essential.holdings = data.holdings
  }

  if (data.fundamentals) {
    essential.fundamentalsSummary = summarizeFundamentals(data.fundamentals)
  }

  return essential
}

/**
 * Validate actionable advice (ensure specific numbers)
 */
export function validateActionableAdvice(advice) {
  const issues = []
  const vagueTerms = ['逢低', '適量', '近期', '高檔', '支撐', '壓力']

  for (const term of vagueTerms) {
    if (advice.includes(term)) {
      issues.push(`發現模糊用語「${term}」，請更具體`)
    }
  }

  if (!advice.match(/\d+/)) {
    issues.push('沒有具體數字，請提供價位')
  }

  return {
    valid: issues.length === 0,
    issues,
  }
}

/**
 * Calculate position size based on risk settings
 */
export function calculatePositionSize({ totalCapital, riskPerTrade, entryPrice, stopLossPrice }) {
  const riskAmount = totalCapital * (riskPerTrade / 100)
  const riskPerShare = entryPrice - stopLossPrice

  if (riskPerShare <= 0) {
    return {
      shares: 0,
      positionValue: 0,
      error: '停損價必須低於進場價',
    }
  }

  const shares = Math.floor(riskAmount / riskPerShare)
  const positionValue = shares * entryPrice

  return {
    shares,
    positionValue,
    riskAmount,
    riskPercent: (positionValue / totalCapital) * 100,
  }
}

/**
 * Check portfolio risk limits
 */
export function checkRiskLimits(holdings, settings) {
  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0)
  const sectorExposure = {}
  const warnings = []

  if (totalValue === 0) return warnings

  for (const holding of holdings) {
    const positionPercent = (holding.value / totalValue) * 100
    if (positionPercent > settings.maxPosition) {
      warnings.push({
        type: 'position_limit',
        stockId: holding.stockId || holding.code,
        message: `${holding.name} 持倉 ${positionPercent.toFixed(1)}% 超過上限 ${settings.maxPosition}%`,
      })
    }

    const sector = holding.sector || 'unknown'
    sectorExposure[sector] = (sectorExposure[sector] || 0) + holding.value
  }

  for (const [sector, value] of Object.entries(sectorExposure)) {
    const sectorPercent = (value / totalValue) * 100
    if (sectorPercent > settings.maxSector) {
      warnings.push({
        type: 'sector_limit',
        sector,
        message: `${sector} 產業集中度 ${sectorPercent.toFixed(1)}% 超過上限 ${settings.maxSector}%`,
      })
    }
  }

  return warnings
}

/**
 * Build Taiwan market context for AI prompt
 */
export function buildTaiwanMarketContext(date = new Date()) {
  const month = date.getMonth() + 1
  const day = date.getDate()
  const quarter = Math.ceil(month / 3)

  const context = {
    month,
    day,
    quarter,
  }

  // 月營收節奏
  context.revenueCycle = {
    isReleaseWindow: day >= 1 && day <= 15,
    message: `${month}月營收將於${month === 12 ? 1 : month + 1}/10 前公布`,
  }

  // 財報季
  context.financialReportCycle = {
    isReleaseWindow: [3, 5, 8, 11].includes(month),
    message: `${quarter}Q 財報將於${month}/15 前公布`,
  }

  // 除權息季節
  context.dividendSeason = {
    isSeason: month >= 5 && month <= 9,
    message:
      month >= 3 && month <= 4
        ? '除權息旺季即將到來，注意高殖利率個股'
        : month >= 5 && month <= 9
          ? '除權息旺季中，注意填息走勢'
          : '除權息季節已過',
  }

  // 法人調倉
  context.institutionalCycle = {
    isQuarterEnd: [3, 6, 9, 12].includes(month),
    message: `Q${quarter}季底，注意法人調倉效應`,
  }

  return context
}

/**
 * Format Taiwan market context for AI prompt
 */
export function formatTaiwanMarketContext(context) {
  return `
台股市場脈絡（${new Date().toLocaleDateString('zh-TW')}）：

月營收節奏：${context.revenueCycle.message}
財報季：${context.financialReportCycle.message}
除權息：${context.dividendSeason.message}
法人調倉：${context.institutionalCycle.message}

分析時請注意：
- 使用台股分析師習慣的估值方法（本益比、股價淨值比）
- 考慮台股流動性特點（外資主導、週轉率較高）
- 注意台股特有現象（漲跌停限制、當沖交易）
`
}
