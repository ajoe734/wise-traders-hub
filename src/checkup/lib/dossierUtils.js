import { DEFAULT_FUNDAMENTAL_DRAFT } from '../constants.js'
import { getEventStockCodes } from './eventUtils.js'
import { getSupplyChain, getThemesForStock } from './dataAdapters/index.js'
import { buildKnowledgeContext } from './knowledgeBase.js'

export function buildDailyHoldingDossierContext(dossier, change, { blind = false } = {}) {
  if (!dossier) return ''
  const position = dossier.position || {}
  const targets = dossier.targets || []
  const fundamentals = dossier.fundamentals || {}
  const events = dossier.events || []
  const brainContext = dossier.brainContext || {}

  const priceInfo = blind
    ? `收盤價: N/A (盲測模式)`
    : `收盤價: ${position.price} (${change.changePct >= 0 ? '+' : ''}${change.changePct.toFixed(2)}%)`

  const targetInfo =
    targets.length > 0
      ? `目標價: ${targets.map((t) => `${t.firm} ${t.target}`).join(', ')}`
      : '目標價: 無'

  const fundamentalInfo = fundamentals.revenueMonth
    ? `營收: ${fundamentals.revenueMonth} ${fundamentals.revenueYoY >= 0 ? '+' : ''}${fundamentals.revenueYoY}% YoY`
    : '營收: 無最新資料'

  const eventInfo =
    events.length > 0 ? `事件: ${events.map((e) => `${e.date} ${e.title}`).join(', ')}` : '事件: 無'

  const brainRuleInfo =
    brainContext.matchedRules?.length > 0
      ? `匹配規則: ${brainContext.matchedRules.map((r) => r.text).join('；')}`
      : '匹配規則: 無'
  const supplyChainInfo = buildSupplyChainContext(dossier.code)
  const themeInfo = dossier.stockMeta ? buildThemeContext(dossier.code, dossier.stockMeta) : ''
  const knowledgeInfo = buildKnowledgeContext(dossier.stockMeta ?? {})

  return `
股票代碼: ${dossier.code}
股票名稱: ${dossier.name}
持股數量: ${position.qty}
${priceInfo}
成本: ${position.cost}
市值: ${position.value}
未實現損益: ${position.pnl} (${position.pct >= 0 ? '+' : ''}${position.pct.toFixed(2)}%)

${dossier.thesis ? buildThesisScorecardContext(dossier.thesis) : '投資論文 (Thesis): 無'}
${targetInfo}
${fundamentalInfo}
${eventInfo}
${supplyChainInfo ? `\n供應鏈:\n${supplyChainInfo}` : ''}
${themeInfo ? `${themeInfo}` : ''}
${brainRuleInfo}
${knowledgeInfo ? `\n${knowledgeInfo}` : ''}
`
}

export function buildEventReviewDossiers(reviewedEvent, dossierByCode) {
  if (!reviewedEvent || !dossierByCode) return []
  const codes = getEventStockCodes(reviewedEvent)
  return codes.map((code) => dossierByCode.get(code)).filter(Boolean)
}

export function buildHoldingDossiers(input, options = {}) {
  const config = Array.isArray(input)
    ? { holdings: input, ...options }
    : input && typeof input === 'object'
      ? input
      : {}

  const {
    holdings = [],
    targets = {},
    fundamentals = {},
    analystReports = {},
    newsEvents = [],
    researchHistory = [],
  } = config

  const rows = Array.isArray(holdings) ? holdings : []
  return rows.map((holding) => ({
    code: holding.code,
    name: holding.name,
    position: holding,
    targets: targets[holding.code]?.reports || [],
    fundamentals: fundamentals[holding.code] || null,
    analystReports: analystReports[holding.code]?.items || [],
    events: newsEvents.filter((event) => getEventStockCodes(event).includes(holding.code)),
    research: researchHistory.filter((r) => r.code === holding.code),
    // Add more dossier fields as needed
  }))
}

export function buildResearchHoldingDossierContext(dossier, { compact = false } = {}) {
  if (!dossier) return ''
  const position = dossier.position || {}
  const thesis = dossier.thesis || {}
  const targets = dossier.targets || []
  const fundamentals = dossier.fundamentals || {}

  if (compact) {
    return `${dossier.name}(${dossier.code}) - 持股: ${position.qty}股, 成本: ${position.cost}, 現價: ${position.price}, 損益: ${position.pnl} (${position.pct.toFixed(2)}%)`
  }

  return `
股票代碼: ${dossier.code}
股票名稱: ${dossier.name}
持股數量: ${position.qty}
成本: ${position.cost}
現價: ${position.price}
未實現損益: ${position.pnl} (${position.pct.toFixed(2)}%)

投資論文 (Thesis): ${thesis.reason || '無'}
目標價: ${targets.map((t) => `${t.firm} ${t.target}`).join(', ') || '無'}
最新營收: ${fundamentals.revenueMonth ? `${fundamentals.revenueMonth} ${fundamentals.revenueYoY}% YoY` : '無'}
`
}

export function buildTaiwanHardGateEvidenceRefs(dossier, issues) {
  return issues.map((issue) => ({
    type: 'dossier',
    refId: dossier.code,
    code: dossier.code,
    label: `台股硬閘門：${issue.type} - ${issue.message}`,
    date: new Date().toISOString().slice(0, 10),
  }))
}

export function formatTaiwanHardGateIssueList(issues) {
  return issues.map((issue) => `${issue.type}: ${issue.message}`).join('；')
}

export function listTaiwanHardGateIssues(_dossier) {
  const issues = []
  // Placeholder for actual hard gate logic
  // Example:
  // if (!dossier.fundamentals?.revenueMonth) {
  //   issues.push({ type: "fundamentals", message: "月營收資料缺失", status: "missing" });
  // }
  return issues
}

export function normalizeFundamentalsEntry(value) {
  if (!value || typeof value !== 'object') return null
  return {
    code: String(value.code || '').trim(),
    revenueMonth: String(value.revenueMonth || '').trim(),
    revenueYoY: Number(value.revenueYoY) || 0,
    revenueMoM: Number(value.revenueMoM) || 0,
    quarter: String(value.quarter || '').trim(),
    eps: Number(value.eps) || 0,
    grossMargin: Number(value.grossMargin) || 0,
    roe: Number(value.roe) || 0,
    source: String(value.source || '').trim(),
    updatedAt: String(value.updatedAt || '').trim(),
    note: String(value.note || '').trim(),
  }
}

export function normalizeFundamentalsStore(value) {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value)
      .map(([code, entry]) => [code, normalizeFundamentalsEntry(entry)])
      .filter(([, entry]) => Boolean(entry))
  )
}

export function formatFundamentalsSummary(entry) {
  const normalized = normalizeFundamentalsEntry(entry)
  if (!normalized) return '無基本面資料'

  const parts = []
  if (normalized.revenueMonth) {
    parts.push(`月營收 ${normalized.revenueMonth}`)
  }
  if (Number.isFinite(normalized.revenueYoY) && normalized.revenueYoY !== 0) {
    parts.push(`YoY ${normalized.revenueYoY >= 0 ? '+' : ''}${normalized.revenueYoY}%`)
  }
  if (Number.isFinite(normalized.revenueMoM) && normalized.revenueMoM !== 0) {
    parts.push(`MoM ${normalized.revenueMoM >= 0 ? '+' : ''}${normalized.revenueMoM}%`)
  }
  if (normalized.quarter) {
    parts.push(`季度 ${normalized.quarter}`)
  }
  if (Number.isFinite(normalized.eps) && normalized.eps !== 0) {
    parts.push(`EPS ${normalized.eps}`)
  }
  if (Number.isFinite(normalized.grossMargin) && normalized.grossMargin !== 0) {
    parts.push(`毛利率 ${normalized.grossMargin}%`)
  }
  if (Number.isFinite(normalized.roe) && normalized.roe !== 0) {
    parts.push(`ROE ${normalized.roe}%`)
  }

  return parts.length > 0 ? parts.join(' · ') : '無可用基本面摘要'
}

export function normalizeHoldingDossiers(value) {
  if (!Array.isArray(value)) return []
  return value.map(normalizeHoldingDossier).filter(Boolean)
}

export function normalizeHoldingDossier(value) {
  if (!value || typeof value !== 'object') return null
  const code = String(value.code || '').trim()
  if (!code) return null
  return {
    code,
    name: String(value.name || code).trim(),
    position: value.position || null, // Assuming normalizeHoldingRow is used here
    thesis: value.thesis || null,
    targets: Array.isArray(value.targets) ? value.targets : [],
    fundamentals: normalizeFundamentalsEntry(value.fundamentals),
    analystReports: Array.isArray(value.analystReports) ? value.analystReports : [],
    events: Array.isArray(value.events) ? value.events : [],
    research: Array.isArray(value.research) ? value.research : [],
    brainContext: value.brainContext || null,
    freshness: value.freshness || null,
    validationSignals: value.validationSignals || null,
  }
}

export function normalizeTaiwanValidationSignalStatus(value) {
  if (!value || typeof value !== 'object') return 'missing'
  return String(value.status || 'missing').trim()
}

export function formatTaiwanValidationSignalLabel(value) {
  const status =
    typeof value === 'string' ? value.trim() : normalizeTaiwanValidationSignalStatus(value)

  switch (status) {
    case 'fresh':
      return '新鮮'
    case 'stale':
      return '過期'
    case 'ok':
      return '正常'
    case 'warning':
      return '需留意'
    case 'missing':
    default:
      return '缺失'
  }
}

/**
 * 建立供應鏈 context 文字（for AI prompt）
 */
export function buildSupplyChainContext(code) {
  const chain = getSupplyChain(code)
  if (!chain) return ''

  const parts = []

  if (chain.upstream.length > 0) {
    const upstreamText = chain.upstream
      .map((s) => `${s.name}(${s.product}${s.dependency === 'high' ? ',高度依賴' : ''})`)
      .join(', ')
    parts.push(`上游: ${upstreamText}`)
  }

  if (chain.downstream.length > 0) {
    const downstreamText = chain.downstream
      .map((s) => `${s.name}(${s.product}${s.revenueShare ? ',' + s.revenueShare + '營收' : ''})`)
      .join(', ')
    parts.push(`下游: ${downstreamText}`)
  }

  if (chain.customers.length > 0) {
    parts.push(`主要客戶: ${chain.customers.join(', ')}`)
  }

  if (chain.suppliers.length > 0) {
    parts.push(`主要供應商: ${chain.suppliers.join(', ')}`)
  }

  return parts.join('\n')
}

/**
 * 建立主題 context 文字（for AI prompt）
 */
export function buildThemeContext(code, stockMeta) {
  if (!stockMeta?.themes?.length) return ''

  const themes = stockMeta.themes.map((name) => {
    const found = getThemesForStock(code).find((t) => t.name === name)
    if (found) return `${name}(${found.count}家)`
    return name
  })

  return `相關主題: ${themes.join(', ')}`
}

/**
 * Build thesis scorecard context for AI prompt
 */
export function buildThesisScorecardContext(thesis) {
  if (!thesis) return ''

  const statement = thesis.statement || thesis.reason || ''
  const direction = thesis.direction || 'long'
  const conviction = thesis.conviction || 'medium'

  const pillarLines = (thesis.pillars || [])
    .map((p) => `  - ${p.text} [${p.status}] trend:${p.trend || 'stable'}`)
    .join('\n')

  const riskLines = (thesis.risks || [])
    .map((r) => `  - ${r.text}${r.triggered ? ' [TRIGGERED]' : ''}`)
    .join('\n')

  const priceInfo = []
  if (thesis.targetPrice) priceInfo.push(`目標價: ${thesis.targetPrice}`)
  if (thesis.stopLoss) priceInfo.push(`停損價: ${thesis.stopLoss}`)

  return `Thesis (${direction}): ${statement}
Conviction: ${conviction}${pillarLines ? `\nPillars:\n${pillarLines}` : ''}${riskLines ? `\nRisks:\n${riskLines}` : ''}${priceInfo.length > 0 ? `\n${priceInfo.join(' / ')}` : ''}`
}

export function createDefaultFundamentalDraft(overrides = {}) {
  return { ...DEFAULT_FUNDAMENTAL_DRAFT, ...overrides }
}
