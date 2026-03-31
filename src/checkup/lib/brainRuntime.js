import { OWNER_PORTFOLIO_ID, BRAIN_VALIDATION_CASE_LIMIT } from '../constants.js'
import { parseFlexibleDate, daysSince, computeStaleness } from './datetime.js'
import { normalizeEventOutcomeLabel } from './events.js'
import {
  buildTaiwanHardGateEvidenceRefs,
  formatTaiwanHardGateIssueList,
  listTaiwanHardGateIssues,
} from './dossierUtils.js'

function toSlashDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}/${month}/${day}`
}

export function createEmptyBrainChecklists() {
  return {
    preEntry: [],
    preAdd: [],
    preExit: [],
  }
}

export function normalizeBrainChecklistStage(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
  if (!raw) return ''
  if (raw === 'entry' || raw === 'preentry') return 'preEntry'
  if (raw === 'add' || raw === 'preadd') return 'preAdd'
  if (raw === 'exit' || raw === 'preexit') return 'preExit'
  return ''
}

export function brainChecklistStageLabel(stage) {
  if (stage === 'preEntry') return '進場前'
  if (stage === 'preAdd') return '加碼前'
  if (stage === 'preExit') return '出場前'
  return '未分類'
}

export function normalizeBrainChecklistItems(items) {
  return Array.isArray(items)
    ? Array.from(new Set(items.map((item) => String(item || '').trim()).filter(Boolean))).slice(
        0,
        12
      )
    : []
}

export function normalizeBrainStringList(items, { limit = 8 } = {}) {
  return Array.isArray(items)
    ? Array.from(new Set(items.map((item) => String(item || '').trim()).filter(Boolean))).slice(
        0,
        limit
      )
    : []
}

export function brainRuleText(rule) {
  if (typeof rule === 'string') return rule.trim()
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return ''
  return String(rule.text || rule.rule || '').trim()
}

export function brainRuleKey(rule) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return ''
  return String(rule.id || '').trim() || brainRuleText(rule)
}

export function normalizeBrainRuleStaleness(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  return ['fresh', 'aging', 'stale', 'missing'].includes(normalized) ? normalized : ''
}

export function brainRuleStalenessLabel(value) {
  switch (normalizeBrainRuleStaleness(value)) {
    case 'fresh':
      return '新鮮'
    case 'aging':
      return '待更新'
    case 'stale':
      return '陳舊'
    case 'missing':
      return '未驗證'
    default:
      return ''
  }
}

export function brainRuleStalenessRank(value) {
  switch (normalizeBrainRuleStaleness(value)) {
    case 'fresh':
      return 3
    case 'aging':
      return 2
    case 'stale':
      return 1
    case 'missing':
    default:
      return 0
  }
}

export function normalizeBrainEvidenceType(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  return [
    'analysis',
    'research',
    'review',
    'event',
    'fundamental',
    'target',
    'report',
    'dossier',
    'note',
  ].includes(normalized)
    ? normalized
    : 'note'
}

export function normalizeBrainEvidenceRef(value) {
  if (typeof value === 'string') {
    const label = value.trim()
    return label ? { type: 'note', refId: null, code: null, label, date: null } : null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const label = String(value.label || value.text || value.title || '').trim()
  if (!label) return null
  return {
    type: normalizeBrainEvidenceType(value.type),
    refId: String(value.refId || value.id || '').trim() || null,
    code: String(value.code || '').trim() || null,
    label,
    date: String(value.date || value.updatedAt || '').trim() || null,
  }
}

export function normalizeBrainEvidenceRefs(value) {
  return Array.isArray(value)
    ? value.map(normalizeBrainEvidenceRef).filter(Boolean).slice(0, 8)
    : []
}

export function normalizeBrainAnalogVerdict(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  return ['supported', 'mixed', 'contradicted'].includes(normalized) ? normalized : ''
}

export function brainAnalogVerdictLabel(value) {
  switch (normalizeBrainAnalogVerdict(value)) {
    case 'supported':
      return '支持'
    case 'mixed':
      return '部分支持'
    case 'contradicted':
      return '相反'
    default:
      return ''
  }
}

export function normalizeBrainAnalogDifferenceType(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  return ['none', 'stock_specific', 'market_regime', 'timing', 'liquidity', 'rule_miss'].includes(
    normalized
  )
    ? normalized
    : ''
}

export function brainAnalogDifferenceTypeLabel(value) {
  switch (normalizeBrainAnalogDifferenceType(value)) {
    case 'none':
      return '無明顯差異'
    case 'stock_specific':
      return '個股特性差異'
    case 'market_regime':
      return '市場節奏不同'
    case 'timing':
      return '時間窗口不同'
    case 'liquidity':
      return '流動性差異'
    case 'rule_miss':
      return '規則判斷失準'
    default:
      return ''
  }
}

export function normalizeBrainAnalogCase(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const code = String(value.code || '').trim()
  const name = String(value.name || '').trim()
  const thesis = String(value.thesis || value.reason || '').trim()
  const verdict = normalizeBrainAnalogVerdict(value.verdict)
  const differenceType = normalizeBrainAnalogDifferenceType(value.differenceType)
  if (!code && !name && !thesis) return null
  return {
    code,
    name,
    period: String(value.period || value.window || '').trim(),
    thesis,
    verdict,
    differenceType,
    note: String(value.note || value.notes || '').trim(),
  }
}

export function normalizeBrainAnalogCases(value) {
  return Array.isArray(value) ? value.map(normalizeBrainAnalogCase).filter(Boolean).slice(0, 5) : []
}

export function latestBrainEvidenceDate(lastValidatedAt, evidenceRefs) {
  const candidates = [
    lastValidatedAt,
    ...(Array.isArray(evidenceRefs) ? evidenceRefs.map((ref) => ref?.date).filter(Boolean) : []),
  ]
    .map((item) => ({ raw: item, parsed: parseFlexibleDate(item) }))
    .filter((item) => item.parsed)

  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.parsed.getTime() - a.parsed.getTime())
  return candidates[0].raw
}

export function deriveBrainRuleStaleness(
  { lastValidatedAt = null, evidenceRefs = [] } = {},
  { now = new Date() } = {}
) {
  const latestDate = latestBrainEvidenceDate(lastValidatedAt, evidenceRefs)
  if (!latestDate) return 'missing'
  const freshness = computeStaleness(latestDate, 30, { now })
  if (freshness === 'fresh') return 'fresh'
  const age = daysSince(latestDate, now)
  if (age == null) return 'missing'
  return age <= 90 ? 'aging' : 'stale'
}

export function deriveBrainRuleValidationScore({
  confidence = null,
  evidenceCount = 0,
  staleness = '',
  status = 'active',
} = {}) {
  const hasConfidence = Number.isFinite(confidence)
  const hasEvidence = Number.isFinite(evidenceCount) && evidenceCount > 0
  const normalizedStaleness = normalizeBrainRuleStaleness(staleness)
  if (!hasConfidence && !hasEvidence && !['fresh', 'aging', 'stale'].includes(normalizedStaleness))
    return null

  let score = hasConfidence ? Math.round((confidence / 10) * 55) : 25
  score += hasEvidence ? Math.min(30, Math.round(evidenceCount) * 6) : 0

  if (normalizedStaleness === 'fresh') score += 15
  if (normalizedStaleness === 'aging') score += 7
  if (normalizedStaleness === 'stale') score -= 8
  if (normalizedStaleness === 'missing') score -= 12

  if (status === 'candidate') score = Math.min(score, 69)
  return Math.max(0, Math.min(100, Math.round(score)))
}

export function brainRuleEvidenceSummary(evidenceRefs, { limit = 2 } = {}) {
  const refs = Array.isArray(evidenceRefs) ? evidenceRefs.filter(Boolean) : []
  if (refs.length === 0) return ''
  const labels = refs
    .map((ref) => String(ref?.label || '').trim())
    .filter(Boolean)
    .slice(0, limit)
  if (labels.length === 0) return `證據${refs.length}筆`
  return `證據${refs.length}筆：${labels.join('、')}${refs.length > limit ? '…' : ''}`
}

export function brainRuleMetaParts(rule, { includeEvidencePreview = false } = {}) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return []
  return [
    rule.when ? `條件:${rule.when}` : null,
    rule.action ? `動作:${rule.action}` : null,
    rule.scope ? `範圍:${rule.scope}` : null,
    (rule.appliesTo || []).length > 0 ? `適用:${rule.appliesTo.slice(0, 3).join('/')}` : null,
    rule.marketRegime ? `市況:${rule.marketRegime}` : null,
    rule.catalystWindow ? `窗口:${rule.catalystWindow}` : null,
    rule.confidence != null ? `信心${rule.confidence}/10` : null,
    rule.evidenceCount > 0 ? `驗證${rule.evidenceCount}次` : null,
    rule.validationScore != null ? `驗證分${rule.validationScore}` : null,
    rule.lastValidatedAt ? `最近驗證${rule.lastValidatedAt}` : null,
    rule.staleness ? `狀態:${brainRuleStalenessLabel(rule.staleness)}` : null,
    rule.checklistStage ? `檢查點:${brainChecklistStageLabel(rule.checklistStage)}` : null,
    (rule.historicalAnalogs || []).length > 0 ? `歷史比對${rule.historicalAnalogs.length}例` : null,
    includeEvidencePreview ? brainRuleEvidenceSummary(rule.evidenceRefs) : null,
  ].filter(Boolean)
}

export function compareBrainRulesByStrength(a, b) {
  const scoreDiff = (Number(b?.validationScore) || -1) - (Number(a?.validationScore) || -1)
  if (scoreDiff !== 0) return scoreDiff
  const freshnessDiff = brainRuleStalenessRank(b?.staleness) - brainRuleStalenessRank(a?.staleness)
  if (freshnessDiff !== 0) return freshnessDiff
  const evidenceDiff = (Number(b?.evidenceCount) || 0) - (Number(a?.evidenceCount) || 0)
  if (evidenceDiff !== 0) return evidenceDiff
  const confidenceDiff = (Number(b?.confidence) || 0) - (Number(a?.confidence) || 0)
  if (confidenceDiff !== 0) return confidenceDiff
  return brainRuleText(a).localeCompare(brainRuleText(b), 'zh-Hant')
}

export function normalizeBrainAuditConfidence(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  if (numeric >= 0 && numeric <= 1) return Math.round(numeric * 100)
  if (numeric >= 1 && numeric <= 10) return Math.round(numeric * 10)
  return Math.max(0, Math.min(100, Math.round(numeric)))
}

export function normalizeBrainAuditItem(value, defaultBucket = 'validated') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const text = brainRuleText(value) || String(value.ruleText || '').trim()
  const id = String(value.id || value.ruleId || '').trim() || null
  if (!text && !id) return null
  const bucket = ['validated', 'stale', 'invalidated'].includes(value.bucket)
    ? value.bucket
    : defaultBucket
  return {
    id,
    text: text || '',
    bucket,
    reason: String(value.reason || value.note || '').trim(),
    confidence: normalizeBrainAuditConfidence(value.confidence),
    lastValidatedAt: String(value.lastValidatedAt || '').trim() || null,
    staleness: normalizeBrainRuleStaleness(value.staleness) || '',
    nextStatus: ['active', 'candidate', 'archived'].includes(value.nextStatus)
      ? value.nextStatus
      : '',
    evidenceRefs: normalizeBrainEvidenceRefs(value.evidenceRefs),
  }
}

export function createEmptyBrainAudit() {
  return {
    validatedRules: [],
    staleRules: [],
    invalidatedRules: [],
  }
}

export function normalizeBrainAuditBuckets(value) {
  const normalized = createEmptyBrainAudit()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return normalized
  normalized.validatedRules = Array.isArray(value.validatedRules)
    ? value.validatedRules
        .map((item) => normalizeBrainAuditItem(item, 'validated'))
        .filter(Boolean)
        .slice(0, 20)
    : []
  normalized.staleRules = Array.isArray(value.staleRules)
    ? value.staleRules
        .map((item) => normalizeBrainAuditItem(item, 'stale'))
        .filter(Boolean)
        .slice(0, 20)
    : []
  normalized.invalidatedRules = Array.isArray(value.invalidatedRules)
    ? value.invalidatedRules
        .map((item) => normalizeBrainAuditItem(item, 'invalidated'))
        .filter(Boolean)
        .slice(0, 20)
    : []
  return normalized
}

export function mergeBrainEvidenceRefs(primaryRefs, secondaryRefs, { limit = 4 } = {}) {
  return normalizeBrainEvidenceRefs([
    ...normalizeBrainEvidenceRefs(primaryRefs),
    ...normalizeBrainEvidenceRefs(secondaryRefs),
  ]).slice(0, limit)
}

export function attachEvidenceRefsToBrainAudit(
  brainAudit,
  evidenceRefs,
  { defaultLastValidatedAt = null } = {}
) {
  const normalized = normalizeBrainAuditBuckets(brainAudit)
  const extraRefs = normalizeBrainEvidenceRefs(evidenceRefs)
  const patchItem = (item, bucket) =>
    normalizeBrainAuditItem(
      {
        ...item,
        bucket,
        lastValidatedAt: item?.lastValidatedAt || defaultLastValidatedAt || '',
        evidenceRefs: mergeBrainEvidenceRefs(item?.evidenceRefs, extraRefs),
      },
      bucket
    )

  return normalizeBrainAuditBuckets({
    validatedRules: normalized.validatedRules.map((item) => patchItem(item, 'validated')),
    staleRules: normalized.staleRules.map((item) => patchItem(item, 'stale')),
    invalidatedRules: normalized.invalidatedRules.map((item) => patchItem(item, 'invalidated')),
  })
}

export function createEmptyBrainValidationStore() {
  return {
    version: 1,
    cases: [],
  }
}

export function normalizeBrainValidationPositionType(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (!normalized) return 'stock'
  if (normalized.includes('權證')) return 'warrant'
  if (normalized.includes('etf')) return 'etf'
  return 'stock'
}

export function brainValidationPositionTypeLabel(value) {
  switch (normalizeBrainValidationPositionType(value)) {
    case 'warrant':
      return '權證'
    case 'etf':
      return 'ETF'
    case 'stock':
    default:
      return '股票'
  }
}

export function normalizeBrainValidationStrategyClass(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text.includes('權證')) return '權證'
  if (text.includes('ETF') || text.includes('指數')) return 'ETF/指數'
  if (text.includes('事件')) return '事件驅動'
  if (text.includes('成長')) return '成長股'
  if (text.includes('景氣')) return '景氣循環'
  if (text.includes('防禦') || text.includes('停損')) return '防禦/停損觀察'
  if (text.includes('轉型')) return '轉型股'
  if (text.includes('價值')) return '價值股'
  return text
}

export function normalizeBrainValidationEventPhase(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  return ['no_event', 'pre_event', 'tracking', 'post_event'].includes(normalized)
    ? normalized
    : 'no_event'
}

export function normalizeBrainValidationIndustryTheme(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text.includes('AI') || text.includes('伺服器')) return 'AI伺服器'
  if (text.includes('PCB') || text.includes('材料') || text.includes('CCL')) return 'PCB/CCL'
  if (text.includes('記憶體') || text.includes('IC')) return '記憶體/半導體'
  if (text.includes('光通訊')) return '光通訊'
  if (text.includes('生技')) return '生技'
  if (text.includes('ETF')) return 'ETF/指數'
  if (text.includes('精密機械')) return '精密機械'
  return text
}

export function normalizeBrainValidationHoldingPeriod(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text.includes('短') && text.includes('長')) return 'mid'
  if (text.includes('短') && text.includes('中')) return 'mid'
  if (text.includes('長')) return 'long'
  if (text.includes('中')) return 'mid'
  if (text.includes('短')) return 'short'
  return ''
}

export function normalizeBrainValidationBand(value, allowed) {
  const normalized = String(value || '').trim()
  return allowed.includes(normalized) ? normalized : 'unknown'
}

export function normalizeBrainValidationFingerprint(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return {
    positionType: normalizeBrainValidationPositionType(value.positionType),
    strategyClass: normalizeBrainValidationStrategyClass(value.strategyClass),
    eventPhase: normalizeBrainValidationEventPhase(value.eventPhase),
    catalystTags: normalizeBrainStringList(value.catalystTags, { limit: 8 }),
    industryTheme: normalizeBrainValidationIndustryTheme(value.industryTheme),
    holdingPeriod: normalizeBrainValidationHoldingPeriod(value.holdingPeriod),
    fundamentalState: {
      revenueYoYBand: normalizeBrainValidationBand(value.fundamentalState?.revenueYoYBand, [
        '<0',
        '0-15',
        '15-30',
        '30+',
        'unknown',
      ]),
      epsState: normalizeBrainValidationBand(value.fundamentalState?.epsState, [
        'up',
        'flat',
        'down',
        'unknown',
      ]),
      grossMarginTrend: normalizeBrainValidationBand(value.fundamentalState?.grossMarginTrend, [
        'up',
        'flat',
        'down',
        'unknown',
      ]),
    },
    priceState: {
      pnlBand: normalizeBrainValidationBand(value.priceState?.pnlBand, [
        '<-15',
        '-15~-5',
        '-5~5',
        '5~15',
        '15+',
        'unknown',
      ]),
      targetGapBand: normalizeBrainValidationBand(value.priceState?.targetGapBand, [
        '>20',
        '10~20',
        '0~10',
        '<0',
        'unknown',
      ]),
    },
    freshness: {
      fundamentals: normalizeBrainRuleStaleness(value.freshness?.fundamentals) || 'missing',
      targets: normalizeBrainRuleStaleness(value.freshness?.targets) || 'missing',
      analyst: normalizeBrainRuleStaleness(value.freshness?.analyst) || 'missing',
      research: normalizeBrainRuleStaleness(value.freshness?.research) || 'missing',
    },
  }
}

export function buildBrainValidationHash(text) {
  const source = String(text || '').trim()
  let hash = 0
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash << 5) - hash + source.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

export function buildBrainRuleKey(rule) {
  const id = String(rule?.id || '').trim()
  if (id) return id
  const text = brainRuleText(rule)
  return text ? `rule-${buildBrainValidationHash(text)}` : `rule-${Date.now()}`
}

export function classifyBrainValidationEventPhase(dossier) {
  const events = dossier?.events || {}
  if (Array.isArray(events.tracking) && events.tracking.length > 0) return 'tracking'
  if (Array.isArray(events.pending) && events.pending.length > 0) return 'pre_event'
  if (events.latestClosed) return 'post_event'
  return 'no_event'
}

export function collectBrainCatalystTags(text) {
  const source = String(text || '').toLowerCase()
  const tags = []
  const matchTag = (tag, patterns) => {
    if (patterns.some((pattern) => source.includes(pattern))) tags.push(tag)
  }
  matchTag('法說', ['法說', '說明會'])
  matchTag('財報', ['財報', 'eps', '獲利'])
  matchTag('月營收', ['月營收', '營收'])
  matchTag('目標價上修', ['目標價上修', '上修'])
  matchTag('目標價下修', ['目標價下修', '下修'])
  matchTag('AI', ['ai', '伺服器'])
  matchTag('ASIC', ['asic'])
  matchTag('CCL', ['ccl', '覆銅板'])
  matchTag('DDR3', ['ddr3'])
  matchTag('漲價', ['漲價', 'asp'])
  matchTag('去庫存', ['去庫存'])
  matchTag('補庫存', ['補庫存'])
  matchTag('政策', ['政策', '補助'])
  matchTag('高殖利率', ['殖利率', '股息'])
  matchTag('匯率', ['匯率', '升值', '貶值'])
  matchTag('中國刺激', ['中國', '刺激'])
  matchTag('生技', ['藥證', '臨床', '授權', '生技'])
  return tags
}

export function revenueYoYBand(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 'unknown'
  if (num < 0) return '<0'
  if (num < 15) return '0-15'
  if (num < 30) return '15-30'
  return '30+'
}

export function epsStateBand(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 'unknown'
  if (num < 0) return 'down'
  if (num < 5) return 'flat'
  return 'up'
}

export function grossMarginBand(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 'unknown'
  if (num < 25) return 'down'
  if (num < 40) return 'flat'
  return 'up'
}

export function pnlBand(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 'unknown'
  if (num < -15) return '<-15'
  if (num < -5) return '-15~-5'
  if (num < 5) return '-5~5'
  if (num < 15) return '5~15'
  return '15+'
}

export function targetGapBand(avgTarget, price) {
  const target = Number(avgTarget)
  const current = Number(price)
  if (!Number.isFinite(target) || !Number.isFinite(current) || current <= 0) return 'unknown'
  const pct = ((target - current) / current) * 100
  if (pct > 20) return '>20'
  if (pct > 10) return '10~20'
  if (pct >= 0) return '0~10'
  return '<0'
}

export function buildScenarioFingerprintFromDossier(dossier) {
  if (!dossier) return null
  const position = dossier.position || {}
  const meta = dossier.meta || {}
  const fundamentals = dossier.fundamentals || {}
  const targets = dossier.targets || {}
  const analyst = dossier.analyst || {}
  const research = dossier.research || {}
  const events = dossier.events || {}
  const catalystText = [
    meta.strategy,
    meta.industry,
    dossier.thesis?.summary,
    analyst.summary,
    research.summary,
    ...(Array.isArray(events.pending) ? events.pending.map((item) => item?.title) : []),
    ...(Array.isArray(events.tracking) ? events.tracking.map((item) => item?.title) : []),
  ]
    .filter(Boolean)
    .join(' | ')
  return normalizeBrainValidationFingerprint({
    positionType: position.type,
    strategyClass: meta.strategy,
    eventPhase: classifyBrainValidationEventPhase(dossier),
    catalystTags: collectBrainCatalystTags(catalystText),
    industryTheme: meta.industry,
    holdingPeriod: meta.period,
    fundamentalState: {
      revenueYoYBand: revenueYoYBand(fundamentals.revenueYoY),
      epsState: epsStateBand(fundamentals.eps),
      grossMarginTrend: grossMarginBand(fundamentals.grossMargin),
    },
    priceState: {
      pnlBand: pnlBand(position.pct),
      targetGapBand: targetGapBand(targets.avgTarget, position.price),
    },
    freshness: {
      fundamentals: fundamentals.freshness,
      targets: targets.freshness,
      analyst: analyst.freshness,
      research: research.freshness,
    },
  })
}

export function ratioOverlap(a, b) {
  const left = Array.isArray(a) ? a : []
  const right = Array.isArray(b) ? b : []
  if (left.length === 0 || right.length === 0) return 0
  const rightSet = new Set(right)
  const matched = left.filter((item) => rightSet.has(item)).length
  return matched / Math.max(left.length, right.length, 1)
}

export function isHardExcludedAnalog(left, right) {
  if (!left || !right) return true
  if (left.positionType !== right.positionType) {
    if (left.positionType === 'warrant' || right.positionType === 'warrant') return true
    if (left.positionType === 'etf' || right.positionType === 'etf') return true
  }
  if (
    ['權證', 'ETF/指數'].includes(left.strategyClass) ||
    ['權證', 'ETF/指數'].includes(right.strategyClass)
  ) {
    if (left.strategyClass !== right.strategyClass) return true
  }
  if (
    (left.eventPhase === 'pre_event' && right.eventPhase === 'post_event') ||
    (left.eventPhase === 'post_event' && right.eventPhase === 'pre_event')
  ) {
    return true
  }
  return false
}

export function scoreBrainValidationAnalog(left, right) {
  if (!left || !right || isHardExcludedAnalog(left, right)) {
    return {
      score: 0,
      excluded: true,
      matchedDimensions: [],
      mismatchedDimensions: ['hard_exclusion'],
    }
  }

  let score = 0
  const matchedDimensions = []
  const mismatchedDimensions = []

  if (left.positionType === right.positionType) {
    score += 18
    matchedDimensions.push('positionType')
  } else mismatchedDimensions.push('positionType')
  if (left.strategyClass && left.strategyClass === right.strategyClass) {
    score += 18
    matchedDimensions.push('strategyClass')
  } else mismatchedDimensions.push('strategyClass')

  if (left.eventPhase === right.eventPhase) {
    score += 14
    matchedDimensions.push('eventPhase')
  } else if (
    (left.eventPhase === 'pre_event' && right.eventPhase === 'tracking') ||
    (left.eventPhase === 'tracking' && right.eventPhase === 'pre_event')
  ) {
    score += 7
    matchedDimensions.push('eventPhase')
  } else if (
    (left.eventPhase === 'tracking' && right.eventPhase === 'post_event') ||
    (left.eventPhase === 'post_event' && right.eventPhase === 'tracking')
  ) {
    score += 6
    matchedDimensions.push('eventPhase')
  } else {
    mismatchedDimensions.push('eventPhase')
  }

  const catalystOverlap = ratioOverlap(left.catalystTags, right.catalystTags)
  if (catalystOverlap >= 0.67) {
    score += 14
    matchedDimensions.push('catalystTags')
  } else if (catalystOverlap >= 0.34) {
    score += 9
    matchedDimensions.push('catalystTags')
  } else if (catalystOverlap > 0) {
    score += 5
    matchedDimensions.push('catalystTags')
  } else mismatchedDimensions.push('catalystTags')

  if (left.industryTheme && left.industryTheme === right.industryTheme) {
    score += 10
    matchedDimensions.push('industryTheme')
  } else mismatchedDimensions.push('industryTheme')

  if (left.holdingPeriod && left.holdingPeriod === right.holdingPeriod) {
    score += 8
    matchedDimensions.push('holdingPeriod')
  } else if (
    [left.holdingPeriod, right.holdingPeriod].includes('mid') &&
    left.holdingPeriod &&
    right.holdingPeriod
  ) {
    score += 4
    matchedDimensions.push('holdingPeriod')
  } else mismatchedDimensions.push('holdingPeriod')

  const fundamentalsMatched = [
    left.fundamentalState?.revenueYoYBand === right.fundamentalState?.revenueYoYBand,
    left.fundamentalState?.epsState === right.fundamentalState?.epsState,
    left.fundamentalState?.grossMarginTrend === right.fundamentalState?.grossMarginTrend,
  ].filter(Boolean).length
  if (fundamentalsMatched === 3) {
    score += 10
    matchedDimensions.push('fundamentalState')
  } else if (fundamentalsMatched === 2) {
    score += 7
    matchedDimensions.push('fundamentalState')
  } else if (fundamentalsMatched === 1) {
    score += 3
    matchedDimensions.push('fundamentalState')
  } else mismatchedDimensions.push('fundamentalState')

  const priceMatched = [
    left.priceState?.pnlBand === right.priceState?.pnlBand,
    left.priceState?.targetGapBand === right.priceState?.targetGapBand,
  ].filter(Boolean).length
  if (priceMatched === 2) {
    score += 8
    matchedDimensions.push('priceState')
  } else if (priceMatched === 1) {
    score += 4
    matchedDimensions.push('priceState')
  } else mismatchedDimensions.push('priceState')

  const freshnessPenalty = [
    { key: 'fundamentals', weight: 12 },
    { key: 'targets', weight: 10 },
    { key: 'analyst', weight: 8 },
    { key: 'research', weight: 5 },
  ].reduce((sum, item) => {
    const status = left.freshness?.[item.key]
    return sum + (['stale', 'missing'].includes(status) ? item.weight : 0)
  }, 0)

  score -= freshnessPenalty
  return {
    score: Math.max(0, Math.min(100, score)),
    excluded: false,
    matchedDimensions,
    mismatchedDimensions,
  }
}

export function classifyBrainDifferenceType(reason, bucket) {
  const source = String(reason || '').toLowerCase()
  if (!source) return bucket === 'invalidated' ? 'rule_miss' : 'none'
  if (
    ['流動性', '量能', '權證', '換手', '成交'].some((token) => source.includes(token.toLowerCase()))
  )
    return 'liquidity'
  if (
    ['市況', '題材', '輪動', '風險偏好', '大盤', '資金'].some((token) =>
      source.includes(token.toLowerCase())
    )
  )
    return 'market_regime'
  if (
    ['法說', '月營收', '財報', '時間', '時序', '窗口'].some((token) =>
      source.includes(token.toLowerCase())
    )
  )
    return 'timing'
  if (
    ['個股', '供應鏈', '客戶', '產品', '藥證', '內部人'].some((token) =>
      source.includes(token.toLowerCase())
    )
  )
    return 'stock_specific'
  return bucket === 'invalidated' ? 'rule_miss' : 'none'
}

export function refineBrainDifferenceType(
  baseType,
  { reviewOutcome = null, bestComparison = null } = {}
) {
  if (bestComparison?.differenceType && bestComparison.differenceType !== 'none')
    return bestComparison.differenceType
  const mismatches = bestComparison?.mismatchedDimensions || []
  if (mismatches.includes('eventPhase')) return 'timing'
  if (mismatches.includes('industryTheme')) return 'stock_specific'
  if (mismatches.includes('priceState')) return 'market_regime'
  if (reviewOutcome?.outcomeLabel === 'contradicted')
    return baseType === 'none' ? 'rule_miss' : baseType
  return baseType
}

export function normalizeBrainValidationMatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const caseId = String(value.caseId || '').trim()
  const code = String(value.code || '').trim()
  const name = String(value.name || '').trim()
  if (!caseId && !code && !name) return null
  return {
    caseId: caseId || null,
    code: code || null,
    name: name || '',
    capturedAt: String(value.capturedAt || '').trim() || null,
    score: Number.isFinite(Number(value.score))
      ? Math.max(0, Math.min(100, Math.round(Number(value.score))))
      : null,
    verdict: normalizeBrainAnalogVerdict(value.verdict),
    differenceType: normalizeBrainAnalogDifferenceType(value.differenceType),
    matchedDimensions: normalizeBrainStringList(value.matchedDimensions, { limit: 8 }),
    mismatchedDimensions: normalizeBrainStringList(value.mismatchedDimensions, { limit: 8 }),
    note: String(value.note || '').trim(),
  }
}

export function normalizeBrainValidationCase(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const caseId = String(value.caseId || '').trim()
  const ruleKey = String(value.ruleKey || '').trim()
  const ruleText = String(value.ruleText || '').trim()
  const code = String(value.code || '').trim()
  if (!caseId || !ruleKey || !ruleText || !code) return null
  const fingerprint = normalizeBrainValidationFingerprint(value.fingerprint)
  if (!fingerprint) return null
  return {
    caseId,
    portfolioId: String(value.portfolioId || '').trim() || OWNER_PORTFOLIO_ID,
    sourceType: ['dailyAnalysis', 'eventReview'].includes(value.sourceType)
      ? value.sourceType
      : 'dailyAnalysis',
    sourceRefId: String(value.sourceRefId || '').trim() || null,
    capturedAt: String(value.capturedAt || '').trim() || toSlashDate(),
    code,
    name: String(value.name || '').trim() || code,
    ruleKey,
    ruleId: String(value.ruleId || '').trim() || null,
    ruleText,
    bucket: ['validated', 'stale', 'invalidated'].includes(value.bucket)
      ? value.bucket
      : 'validated',
    verdict: normalizeBrainAnalogVerdict(value.verdict) || 'supported',
    differenceType: normalizeBrainAnalogDifferenceType(value.differenceType) || 'none',
    note: String(value.note || '').trim(),
    similarityScore: Number.isFinite(Number(value.similarityScore))
      ? Math.max(0, Math.min(100, Math.round(Number(value.similarityScore))))
      : null,
    matchedDimensions: normalizeBrainStringList(value.matchedDimensions, { limit: 8 }),
    mismatchedDimensions: normalizeBrainStringList(value.mismatchedDimensions, { limit: 8 }),
    reviewOutcome:
      value.reviewOutcome &&
      typeof value.reviewOutcome === 'object' &&
      !Array.isArray(value.reviewOutcome)
        ? {
            code: String(value.reviewOutcome.code || code).trim() || code,
            name: String(value.reviewOutcome.name || value.name || '').trim() || code,
            predicted: ['up', 'down', 'neutral'].includes(value.reviewOutcome.predicted)
              ? value.reviewOutcome.predicted
              : null,
            actual: ['up', 'down', 'neutral'].includes(value.reviewOutcome.actual)
              ? value.reviewOutcome.actual
              : null,
            changePct: Number.isFinite(Number(value.reviewOutcome.changePct))
              ? Math.round(Number(value.reviewOutcome.changePct) * 100) / 100
              : null,
            outcomeLabel: normalizeEventOutcomeLabel(value.reviewOutcome.outcomeLabel),
            note: String(value.reviewOutcome.note || '').trim(),
          }
        : null,
    fingerprint,
    evidenceRefs: normalizeBrainEvidenceRefs(value.evidenceRefs),
    analogMatches: Array.isArray(value.analogMatches)
      ? value.analogMatches.map(normalizeBrainValidationMatch).filter(Boolean).slice(0, 3)
      : [],
  }
}

export function normalizeBrainValidationStore(value) {
  const normalized = createEmptyBrainValidationStore()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return normalized
  normalized.cases = Array.isArray(value.cases)
    ? value.cases
        .map(normalizeBrainValidationCase)
        .filter(Boolean)
        .sort((a, b) => {
          const aTime = parseFlexibleDate(a?.capturedAt)?.getTime() || 0
          const bTime = parseFlexibleDate(b?.capturedAt)?.getTime() || 0
          return bTime - aTime
        })
        .slice(0, BRAIN_VALIDATION_CASE_LIMIT)
    : []
  return normalized
}

function auditBucketToVerdict(bucket) {
  if (bucket === 'invalidated') return 'contradicted'
  if (bucket === 'stale') return 'mixed'
  return 'supported'
}

function extractReviewOutcomeForCode(reviewEvent, code, name) {
  if (!reviewEvent || typeof reviewEvent !== 'object') return null

  const matchedOutcome = (
    Array.isArray(reviewEvent.stockOutcomes) ? reviewEvent.stockOutcomes : []
  ).find((item) => String(item?.code || '').trim() === code)

  if (matchedOutcome) {
    return {
      code,
      name: String(matchedOutcome.name || name || code).trim() || code,
      predicted: ['up', 'down', 'neutral'].includes(matchedOutcome.predicted)
        ? matchedOutcome.predicted
        : null,
      actual: ['up', 'down', 'neutral'].includes(matchedOutcome.actual)
        ? matchedOutcome.actual
        : null,
      changePct: Number.isFinite(Number(matchedOutcome.changePct))
        ? Math.round(Number(matchedOutcome.changePct) * 100) / 100
        : null,
      outcomeLabel: normalizeEventOutcomeLabel(matchedOutcome.outcomeLabel),
      note: String(matchedOutcome.note || '').trim(),
    }
  }

  const predicted = ['up', 'down', 'neutral'].includes(reviewEvent.pred) ? reviewEvent.pred : null
  const actual = ['up', 'down', 'neutral'].includes(reviewEvent.actual) ? reviewEvent.actual : null
  if (!predicted && !actual) return null

  return {
    code,
    name: String(name || code).trim() || code,
    predicted,
    actual,
    changePct: null,
    outcomeLabel: normalizeEventOutcomeLabel(reviewEvent.outcomeLabel),
    note: String(reviewEvent.actualNote || reviewEvent.reviewNote || '').trim(),
  }
}

export function findTopBrainAnalogMatches(store, fingerprint, { limit = 3, minScore = 35 } = {}) {
  const normalizedStore = normalizeBrainValidationStore(store)
  if (!fingerprint) return []

  return (normalizedStore.cases || [])
    .map((item) => {
      const comparison = scoreBrainValidationAnalog(fingerprint, item.fingerprint)
      if (comparison.excluded || comparison.score < minScore) return null
      return normalizeBrainValidationMatch({
        caseId: item.caseId,
        code: item.code,
        name: item.name,
        capturedAt: item.capturedAt,
        score: comparison.score,
        verdict: item.verdict,
        differenceType: item.differenceType,
        matchedDimensions: comparison.matchedDimensions,
        mismatchedDimensions: comparison.mismatchedDimensions,
        note: item.note,
      })
    })
    .filter(Boolean)
    .sort((a, b) => (Number(b?.score) || 0) - (Number(a?.score) || 0))
    .slice(0, limit)
}

export function createBrainValidationCase({
  portfolioId = OWNER_PORTFOLIO_ID,
  sourceType = 'dailyAnalysis',
  sourceRefId = null,
  dossier = null,
  rule = null,
  auditItem = null,
  capturedAt = toSlashDate(),
  reviewEvent = null,
  analogSource = null,
} = {}) {
  if (!dossier || typeof dossier !== 'object') return null

  const ruleTextValue = brainRuleText(rule) || String(auditItem?.text || '').trim()
  if (!ruleTextValue) return null

  const fingerprint = buildScenarioFingerprintFromDossier(dossier)
  if (!fingerprint) return null

  const normalizedAuditItem = normalizeBrainAuditItem(auditItem, auditItem?.bucket || 'validated')
  const bucket = normalizedAuditItem?.bucket || 'validated'
  const ruleKey = buildBrainRuleKey(
    rule || {
      id: normalizedAuditItem?.id || '',
      text: ruleTextValue,
    }
  )

  const analogMatches = findTopBrainAnalogMatches(analogSource, fingerprint, { limit: 3 })
  const bestComparison = analogMatches[0] || null
  const reviewOutcome = extractReviewOutcomeForCode(reviewEvent, dossier.code, dossier.name)
  const baseDifferenceType =
    normalizeBrainAnalogDifferenceType(normalizedAuditItem?.differenceType) ||
    classifyBrainDifferenceType(normalizedAuditItem?.reason, bucket)
  const differenceType = refineBrainDifferenceType(baseDifferenceType, {
    reviewOutcome,
    bestComparison,
  })

  return normalizeBrainValidationCase({
    caseId: `vcase-${buildBrainValidationHash(
      [portfolioId, sourceType, sourceRefId, dossier.code, ruleKey, bucket, capturedAt]
        .filter(Boolean)
        .join('|')
    )}`,
    portfolioId,
    sourceType,
    sourceRefId,
    capturedAt,
    code: dossier.code,
    name: dossier.name,
    ruleKey,
    ruleId: String(rule?.id || normalizedAuditItem?.id || '').trim() || null,
    ruleText: ruleTextValue,
    bucket,
    verdict: reviewOutcome?.outcomeLabel || auditBucketToVerdict(bucket),
    differenceType,
    note: String(normalizedAuditItem?.reason || '').trim(),
    similarityScore: bestComparison?.score || null,
    matchedDimensions: bestComparison?.matchedDimensions || [],
    mismatchedDimensions: bestComparison?.mismatchedDimensions || [],
    reviewOutcome,
    fingerprint,
    evidenceRefs: mergeBrainEvidenceRefs(normalizedAuditItem?.evidenceRefs, rule?.evidenceRefs),
    analogMatches,
  })
}

export function appendBrainValidationCases(
  prev,
  {
    portfolioId = OWNER_PORTFOLIO_ID,
    sourceType = 'dailyAnalysis',
    sourceRefId = null,
    dossiers = [],
    brain = null,
    brainAudit = null,
    capturedAt = toSlashDate(),
    reviewEvent = null,
  } = {}
) {
  const normalizedStore = normalizeBrainValidationStore(prev)
  const audit = normalizeBrainAuditBuckets(brainAudit)
  const rows = normalizeHoldingDossiers(dossiers)
  if (rows.length === 0) return normalizedStore

  const currentBrain = normalizeStrategyBrain(brain, { allowEmpty: true })
  const currentRules = [...(currentBrain.rules || []), ...(currentBrain.candidateRules || [])]
  const rulesByKey = new Map(currentRules.map((rule) => [brainRuleKey(rule), rule]))
  const rulesByText = new Map(
    currentRules.map((rule) => [brainRuleText(rule), rule]).filter(([text]) => Boolean(text))
  )
  const nextCases = [...(normalizedStore.cases || [])]

  const upsertCase = (validationCase) => {
    if (!validationCase) return
    const idx = nextCases.findIndex((item) => item.caseId === validationCase.caseId)
    if (idx >= 0) nextCases[idx] = validationCase
    else nextCases.unshift(validationCase)
  }

  const appendFromBucket = (items) => {
    items.forEach((auditItem) => {
      const baseRule =
        rulesByKey.get(String(auditItem?.id || '').trim()) ||
        rulesByText.get(String(auditItem?.text || '').trim()) ||
        null
      const matchedRows = rows.filter((dossier) =>
        ruleMatchesValidationDossier(baseRule, dossier, auditItem)
      )
      const targetRows = matchedRows.length > 0 ? matchedRows : rows

      targetRows.forEach((dossier) => {
        upsertCase(
          createBrainValidationCase({
            portfolioId,
            sourceType,
            sourceRefId,
            dossier,
            rule: baseRule,
            auditItem,
            capturedAt,
            reviewEvent,
            analogSource: normalizedStore,
          })
        )
      })
    })
  }

  appendFromBucket(audit.validatedRules)
  appendFromBucket(audit.staleRules)
  appendFromBucket(audit.invalidatedRules)

  return normalizeBrainValidationStore({
    ...normalizedStore,
    cases: nextCases.slice(0, BRAIN_VALIDATION_CASE_LIMIT),
  })
}

export function normalizeBrainRule(rule, { defaultSource = 'ai', defaultStatus = 'active' } = {}) {
  const text = brainRuleText(rule)
  if (!text) return null
  if (typeof rule === 'string') {
    return {
      id: null,
      text,
      when: '',
      action: '',
      avoid: '',
      scope: '',
      appliesTo: [],
      marketRegime: '',
      catalystWindow: '',
      contextRequired: [],
      invalidationSignals: [],
      historicalAnalogs: [],
      confidence: null,
      evidenceCount: 0,
      validationScore: null,
      lastValidatedAt: null,
      staleness: 'missing',
      evidenceRefs: [],
      status: defaultStatus,
      source: defaultSource,
      checklistStage: '',
      note: '',
    }
  }

  const confidence = Number(rule.confidence)
  const evidenceRefs = normalizeBrainEvidenceRefs(rule.evidenceRefs)
  const historicalAnalogs = normalizeBrainAnalogCases(rule.historicalAnalogs || rule.analogCases)
  const evidenceCount = Number(rule.evidenceCount ?? rule.evidence ?? evidenceRefs.length ?? 0)
  const lastValidatedAt = String(rule.lastValidatedAt || '').trim() || null
  const source = ['ai', 'user', 'coach', 'system'].includes(rule.source)
    ? rule.source
    : defaultSource
  const status = ['active', 'candidate', 'archived'].includes(rule.status)
    ? rule.status
    : defaultStatus
  const normalizedEvidenceCount = Number.isFinite(evidenceCount)
    ? Math.max(0, Math.round(evidenceCount))
    : 0
  const staleness =
    normalizeBrainRuleStaleness(rule.staleness) ||
    deriveBrainRuleStaleness({ lastValidatedAt, evidenceRefs })
  const explicitValidationScore = Number(rule.validationScore)
  const normalizedConfidence = Number.isFinite(confidence)
    ? Math.max(1, Math.min(10, Math.round(confidence)))
    : null
  const validationScore = Number.isFinite(explicitValidationScore)
    ? Math.max(0, Math.min(100, Math.round(explicitValidationScore)))
    : deriveBrainRuleValidationScore({
        confidence: normalizedConfidence,
        evidenceCount: normalizedEvidenceCount,
        staleness,
        status,
      })
  return {
    id: String(rule.id || '').trim() || null,
    text,
    when: String(rule.when || '').trim(),
    action: String(rule.action || '').trim(),
    avoid: String(rule.avoid || '').trim(),
    scope: String(rule.scope || '').trim(),
    appliesTo: normalizeBrainStringList(rule.appliesTo || rule.tags, { limit: 6 }),
    marketRegime: String(rule.marketRegime || '').trim(),
    catalystWindow: String(rule.catalystWindow || '').trim(),
    contextRequired: normalizeBrainStringList(rule.contextRequired, { limit: 6 }),
    invalidationSignals: normalizeBrainStringList(rule.invalidationSignals, { limit: 6 }),
    historicalAnalogs,
    confidence: normalizedConfidence,
    evidenceCount: normalizedEvidenceCount,
    validationScore,
    lastValidatedAt,
    staleness,
    evidenceRefs,
    status,
    source,
    checklistStage: normalizeBrainChecklistStage(rule.checklistStage),
    note: String(rule.note || '').trim(),
  }
}

export function brainRuleSummary(rule, { includeMeta = false } = {}) {
  const text = brainRuleText(rule)
  if (!text) return ''
  if (!includeMeta || !rule || typeof rule !== 'object' || Array.isArray(rule)) return text
  const meta = brainRuleMetaParts(rule, { includeEvidencePreview: false })
  return meta.length > 0 ? `${text}（${meta.join('｜')}）` : text
}

export function hasBrainChecklistContent(checklists) {
  return Object.values(checklists || {}).some((items) => Array.isArray(items) && items.length > 0)
}

export function normalizeBrainChecklists(value, linkedRules = []) {
  const normalized = createEmptyBrainChecklists()
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    normalized.preEntry = normalizeBrainChecklistItems(value.preEntry)
    normalized.preAdd = normalizeBrainChecklistItems(value.preAdd)
    normalized.preExit = normalizeBrainChecklistItems(value.preExit)
  }

  ;(Array.isArray(linkedRules) ? linkedRules : []).forEach((rule) => {
    const stage = normalizeBrainChecklistStage(rule?.checklistStage)
    const text = brainRuleText(rule)
    if (!stage || !text || rule?.status === 'archived') return
    if (!normalized[stage].includes(text)) normalized[stage].push(text)
  })

  normalized.preEntry = normalized.preEntry.slice(0, 12)
  normalized.preAdd = normalized.preAdd.slice(0, 12)
  normalized.preExit = normalized.preExit.slice(0, 12)
  return normalized
}

export function formatBrainRulesForPrompt(rules, { limit = 8 } = {}) {
  const rows = (Array.isArray(rules) ? rules : [])
    .slice(0, limit)
    .map((rule, index) => `${index + 1}. ${brainRuleSummary(rule, { includeMeta: true })}`)
  return rows.length > 0 ? rows.join('\n') : '無'
}

export function formatBrainRulesForValidationPrompt(rules, { limit = 8 } = {}) {
  const rows = (Array.isArray(rules) ? rules : []).slice(0, limit).map((rule, index) => {
    const ruleId = String(rule?.id || '').trim()
    const prefix = ruleId ? `[ruleId:${ruleId}] ` : ''
    return `${index + 1}. ${prefix}${brainRuleSummary(rule, { includeMeta: true })}`
  })
  return rows.length > 0 ? rows.join('\n') : '無'
}

export function formatBrainChecklistsForPrompt(checklists) {
  const normalized = normalizeBrainChecklists(checklists)
  const sections = [
    ['進場前檢查', normalized.preEntry],
    ['加碼前檢查', normalized.preAdd],
    ['出場前檢查', normalized.preExit],
  ]
    .map(([label, items]) =>
      Array.isArray(items) && items.length > 0 ? `${label}：${items.join('；')}` : null
    )
    .filter(Boolean)
  return sections.length > 0 ? sections.join('\n') : '無'
}

export function createEmptyStrategyBrain() {
  return {
    version: 4,
    rules: [],
    candidateRules: [],
    checklists: createEmptyBrainChecklists(),
    lessons: [],
    commonMistakes: [],
    stats: {},
    lastUpdate: null,
    coachLessons: [],
    evolution: '',
  }
}

export function normalizeStrategyBrain(value, { allowEmpty = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return allowEmpty ? createEmptyStrategyBrain() : null
  }

  const normalized = createEmptyStrategyBrain()
  const normalizedRules = Array.isArray(value.rules)
    ? value.rules
        .map((item) => normalizeBrainRule(item, { defaultStatus: 'active' }))
        .filter(Boolean)
    : []
  const inlineCandidates = normalizedRules.filter((rule) => rule.status === 'candidate')
  normalized.rules = normalizedRules.filter((rule) => rule.status !== 'candidate')
  normalized.candidateRules = Array.isArray(value.candidateRules)
    ? value.candidateRules
        .map((item) => normalizeBrainRule(item, { defaultStatus: 'candidate' }))
        .filter(Boolean)
    : inlineCandidates
  normalized.checklists = normalizeBrainChecklists(value.checklists, [
    ...normalized.rules,
    ...normalized.candidateRules,
  ])
  normalized.lessons = Array.isArray(value.lessons)
    ? value.lessons
        .filter((item) => item && typeof item.text === 'string' && item.text.trim())
        .map((item) => ({ date: item.date || toSlashDate(), text: item.text.trim() }))
    : []
  normalized.commonMistakes = Array.isArray(value.commonMistakes)
    ? value.commonMistakes.filter(Boolean)
    : []
  normalized.stats =
    value.stats && typeof value.stats === 'object' && !Array.isArray(value.stats)
      ? { ...value.stats }
      : {}
  normalized.lastUpdate = typeof value.lastUpdate === 'string' ? value.lastUpdate : null
  normalized.evolution = typeof value.evolution === 'string' ? value.evolution.trim() : ''
  normalized.coachLessons = Array.isArray(value.coachLessons)
    ? value.coachLessons
        .filter((item) => item && typeof item.text === 'string' && item.text.trim())
        .map((item) => ({
          date: item.date || toSlashDate(),
          text: item.text.trim(),
          source: item.source || '',
          sourcePortfolioId: item.sourcePortfolioId || '',
          sourceEventId: item.sourceEventId ?? null,
        }))
    : []

  const hasContent =
    normalized.rules.length > 0 ||
    normalized.candidateRules.length > 0 ||
    hasBrainChecklistContent(normalized.checklists) ||
    normalized.lessons.length > 0 ||
    normalized.commonMistakes.length > 0 ||
    normalized.coachLessons.length > 0 ||
    Object.keys(normalized.stats).length > 0 ||
    Boolean(normalized.lastUpdate) ||
    Boolean(normalized.evolution)

  return hasContent || allowEmpty ? normalized : null
}

export function mergeBrainPreservingCoachLessons(nextBrain, currentBrain) {
  if (!nextBrain || typeof nextBrain !== 'object' || Array.isArray(nextBrain)) {
    return normalizeStrategyBrain(currentBrain)
  }
  const normalizedNext = normalizeStrategyBrain(nextBrain, { allowEmpty: true })
  const normalizedCurrent = normalizeStrategyBrain(currentBrain, { allowEmpty: true })
  const coachLessons = normalizedNext?.coachLessons?.length
    ? normalizedNext.coachLessons
    : normalizedCurrent?.coachLessons || []

  const hasField = (key) => Object.prototype.hasOwnProperty.call(nextBrain || {}, key)
  const merged = {
    version: 4,
    rules: hasField('rules') ? normalizedNext?.rules || [] : normalizedCurrent?.rules || [],
    candidateRules: hasField('candidateRules')
      ? normalizedNext?.candidateRules || []
      : normalizedCurrent?.candidateRules || [],
    checklists: hasField('checklists')
      ? normalizedNext?.checklists || createEmptyBrainChecklists()
      : hasField('rules') || hasField('candidateRules')
        ? normalizeBrainChecklists(normalizedCurrent?.checklists, [
            ...(normalizedNext?.rules || []),
            ...(normalizedNext?.candidateRules || []),
          ])
        : normalizedCurrent?.checklists || createEmptyBrainChecklists(),
    lessons: hasField('lessons') ? normalizedNext?.lessons || [] : normalizedCurrent?.lessons || [],
    commonMistakes: hasField('commonMistakes')
      ? normalizedNext?.commonMistakes || []
      : normalizedCurrent?.commonMistakes || [],
    stats: hasField('stats') ? normalizedNext?.stats || {} : normalizedCurrent?.stats || {},
    lastUpdate: hasField('lastUpdate')
      ? normalizedNext?.lastUpdate || null
      : normalizedCurrent?.lastUpdate || null,
    coachLessons,
    evolution: hasField('evolution')
      ? normalizedNext?.evolution || ''
      : normalizedCurrent?.evolution || '',
  }

  return normalizeStrategyBrain(merged, { allowEmpty: true })
}

export function buildBrainTokens(holding, meta) {
  return [
    holding?.code,
    holding?.name,
    meta?.industry,
    meta?.strategy,
    meta?.period,
    meta?.position,
    meta?.leader,
    holding?.type,
  ]
    .filter(Boolean)
    .map((token) => String(token).trim().toLowerCase())
    .filter((token) => token.length >= 2)
}

export function textMatchesBrainTokens(text, tokens) {
  const source = brainRuleText(text).toLowerCase()
  if (!source) return false
  return tokens.some((token) => source.includes(token))
}

export function normalizeHoldingDossiers(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof item.code === 'string' &&
        typeof item.name === 'string'
    )
    .map((item) => ({ ...item }))
}

export function ruleMatchesValidationDossier(rule, dossier, auditItem) {
  if (!dossier) return false
  const codeHints = normalizeBrainStringList(
    [
      ...(Array.isArray(auditItem?.evidenceRefs)
        ? auditItem.evidenceRefs.map((ref) => ref?.code)
        : []),
      ...(Array.isArray(rule?.evidenceRefs) ? rule.evidenceRefs.map((ref) => ref?.code) : []),
    ],
    { limit: 8 }
  )
  if (codeHints.includes(dossier.code)) return true

  const meta = dossier.meta || {}
  const appliesTo = normalizeBrainStringList(rule?.appliesTo, { limit: 8 }).map((item) =>
    item.toLowerCase()
  )
  const tokens = buildBrainTokens(
    { ...dossier.position, code: dossier.code, name: dossier.name },
    meta
  )
  if (codeHints.length === 0 && textMatchesBrainTokens(rule, tokens)) return true
  if (appliesTo.length === 0) return false

  const strategy = normalizeBrainValidationStrategyClass(meta.strategy).toLowerCase()
  const industry = normalizeBrainValidationIndustryTheme(meta.industry).toLowerCase()
  const positionType = brainValidationPositionTypeLabel(dossier.position?.type).toLowerCase()
  return appliesTo.some(
    (item) => strategy.includes(item) || industry.includes(item) || positionType.includes(item)
  )
}

export function ensureBrainAuditCoverage(brainAudit, currentBrain, { dossiers = null } = {}) {
  const normalizedAudit = normalizeBrainAuditBuckets(brainAudit)
  const current = normalizeStrategyBrain(currentBrain, { allowEmpty: true })
  const rows = normalizeHoldingDossiers(dossiers)
  const reviewed = new Set(
    [
      ...normalizedAudit.validatedRules,
      ...normalizedAudit.staleRules,
      ...normalizedAudit.invalidatedRules,
    ]
      .map((item) => item?.id || item?.text)
      .filter(Boolean)
  )

  const staleMap = new Map(
    normalizedAudit.staleRules
      .map((item) => [item?.id || item?.text, item])
      .filter(([key]) => Boolean(key))
  )

  const scopedRules = [...(current.rules || []), ...(current.candidateRules || [])].filter(
    (rule) =>
      rows.length === 0 || rows.some((dossier) => ruleMatchesValidationDossier(rule, dossier, null))
  )

  scopedRules.forEach((rule) => {
    const key = brainRuleKey(rule)
    if (!key || reviewed.has(key) || staleMap.has(key)) return
    const fallbackStaleness =
      normalizeBrainRuleStaleness(rule?.staleness) ||
      (rule?.status === 'candidate' ? 'missing' : 'aging')
    const fallbackConfidence = Number.isFinite(Number(rule?.validationScore))
      ? Math.max(25, Math.min(90, Math.round(Number(rule.validationScore))))
      : Number.isFinite(Number(rule?.confidence))
        ? Math.max(25, Math.min(90, Math.round(Number(rule.confidence) * 10)))
        : 35
    staleMap.set(
      key,
      normalizeBrainAuditItem(
        {
          id: rule?.id || '',
          text: brainRuleText(rule),
          bucket: 'stale',
          reason: '今日分析未明確覆蓋此舊規則，先標記為待更新，避免在缺乏驗證時被當成仍然有效。',
          confidence: fallbackConfidence,
          staleness: fallbackStaleness,
          lastValidatedAt: rule?.lastValidatedAt || '',
          evidenceRefs: rule?.evidenceRefs || [],
        },
        'stale'
      )
    )
  })

  return normalizeBrainAuditBuckets({
    ...normalizedAudit,
    staleRules: Array.from(staleMap.values()),
  })
}

export function enforceTaiwanHardGatesOnBrainAudit(
  brainAudit,
  currentBrain,
  { dossiers = null, defaultLastValidatedAt = null } = {}
) {
  const normalizedAudit = normalizeBrainAuditBuckets(brainAudit)
  const rows = normalizeHoldingDossiers(dossiers)
  if (rows.length === 0) return normalizedAudit

  const current = normalizeStrategyBrain(currentBrain, { allowEmpty: true })
  const currentRules = [...(current.rules || []), ...(current.candidateRules || [])]
  const rulesByKey = new Map(currentRules.map((rule) => [brainRuleKey(rule), rule]))
  const rulesByText = new Map(
    currentRules.map((rule) => [brainRuleText(rule), rule]).filter(([text]) => Boolean(text))
  )

  const staleMap = new Map(
    normalizedAudit.staleRules
      .map((item) => [item?.id || item?.text, item])
      .filter(([key]) => Boolean(key))
  )

  const downgradeIfNeeded = (item) => {
    const key = item?.id || item?.text
    if (!key) return item

    const baseRule =
      rulesByKey.get(String(item?.id || '').trim()) ||
      rulesByText.get(String(item?.text || '').trim()) ||
      null
    const matchedRows = rows.filter((dossier) =>
      ruleMatchesValidationDossier(baseRule, dossier, item)
    )
    if (matchedRows.length === 0) return item

    const issues = matchedRows.flatMap((dossier) => {
      const rowIssues = listTaiwanHardGateIssues(dossier)
      if (!Array.isArray(rowIssues) || rowIssues.length === 0) return []
      return rowIssues.map((issue) => ({
        ...issue,
        dossier,
      }))
    })

    if (issues.length === 0) return item

    const evidenceRefs = issues.flatMap(({ dossier, ...issue }) =>
      buildTaiwanHardGateEvidenceRefs(dossier, [issue])
    )
    const reasonSuffix = formatTaiwanHardGateIssueList(issues)
    staleMap.set(
      key,
      normalizeBrainAuditItem(
        {
          ...item,
          bucket: 'stale',
          reason: [item?.reason, `台股 hard gate：${reasonSuffix}`].filter(Boolean).join('；'),
          staleness: item?.staleness || 'stale',
          lastValidatedAt: item?.lastValidatedAt || defaultLastValidatedAt || '',
          evidenceRefs: mergeBrainEvidenceRefs(item?.evidenceRefs, evidenceRefs, { limit: 6 }),
        },
        'stale'
      )
    )

    return null
  }

  return normalizeBrainAuditBuckets({
    validatedRules: normalizedAudit.validatedRules.map(downgradeIfNeeded).filter(Boolean),
    staleRules: Array.from(staleMap.values()),
    invalidatedRules: normalizedAudit.invalidatedRules.map(downgradeIfNeeded).filter(Boolean),
  })
}

export function applyAuditToBrainRule(
  rule,
  auditItem,
  { status = null, defaultStatus = 'active' } = {}
) {
  const normalized = normalizeBrainRule(
    rule || {
      id: auditItem?.id || null,
      text: auditItem?.text || '',
      status: status || defaultStatus,
    },
    {
      defaultStatus: status || defaultStatus,
    }
  )
  if (!normalized) return null

  const bucket = ['validated', 'stale', 'invalidated'].includes(auditItem?.bucket)
    ? auditItem.bucket
    : 'validated'
  const auditConfidence = normalizeBrainAuditConfidence(auditItem?.confidence)
  const mergedEvidenceRefs = mergeBrainEvidenceRefs(
    auditItem?.evidenceRefs,
    normalized.evidenceRefs
  )
  const normalizedStatus = ['active', 'candidate', 'archived'].includes(status)
    ? status
    : normalized.status || defaultStatus

  let validationScore = Number.isFinite(Number(normalized.validationScore))
    ? Math.round(Number(normalized.validationScore))
    : deriveBrainRuleValidationScore({
        confidence: normalized.confidence,
        evidenceCount: normalized.evidenceCount,
        staleness: normalized.staleness,
        status: normalizedStatus,
      })
  let staleness = normalizeBrainRuleStaleness(normalized.staleness) || 'missing'
  let confidence = normalized.confidence
  let lastValidatedAt = normalized.lastValidatedAt || null

  if (auditConfidence != null) {
    const convertedConfidence = Math.max(1, Math.min(10, Math.round(auditConfidence / 10)))
    confidence =
      confidence != null ? Math.max(confidence, convertedConfidence) : convertedConfidence
  }

  if (bucket === 'validated') {
    staleness = 'fresh'
    lastValidatedAt = auditItem?.lastValidatedAt || toSlashDate()
    validationScore = Math.max(validationScore ?? 0, auditConfidence ?? 70, 70)
  } else if (bucket === 'stale') {
    staleness =
      normalizeBrainRuleStaleness(auditItem?.staleness) ||
      (normalizedStatus === 'candidate' ? 'missing' : 'aging')
    validationScore = Math.min(validationScore ?? 65, auditConfidence ?? 65)
  } else if (bucket === 'invalidated') {
    staleness = 'stale'
    validationScore = Math.min(validationScore ?? 45, auditConfidence ?? 45)
  }

  const evidenceCount = Math.max(
    Number(normalized.evidenceCount) || 0,
    mergedEvidenceRefs.length,
    bucket === 'validated' ? 1 : 0
  )

  return normalizeBrainRule(
    {
      ...normalized,
      status: normalizedStatus,
      confidence,
      evidenceCount,
      validationScore,
      lastValidatedAt,
      staleness,
      evidenceRefs: mergedEvidenceRefs,
      note: String(auditItem?.reason || '').trim() || normalized.note || '',
    },
    {
      defaultStatus: normalizedStatus,
      defaultSource: normalized.source || 'ai',
    }
  )
}

export function mergeBrainWithAuditLifecycle(nextBrain, currentBrain, brainAudit) {
  const normalizedCurrent = normalizeStrategyBrain(currentBrain, { allowEmpty: true })
  const normalizedNext = normalizeStrategyBrain(nextBrain, { allowEmpty: true })
  const coveredAudit = ensureBrainAuditCoverage(brainAudit, normalizedCurrent)

  const currentRules = [
    ...(normalizedCurrent.rules || []),
    ...(normalizedCurrent.candidateRules || []),
  ]
  const nextActiveRules = normalizedNext.rules || []
  const nextCandidateRules = normalizedNext.candidateRules || []

  const currentByKey = new Map(
    currentRules.map((rule) => [brainRuleKey(rule), rule]).filter(([key]) => Boolean(key))
  )
  const nextActiveByKey = new Map(
    nextActiveRules.map((rule) => [brainRuleKey(rule), rule]).filter(([key]) => Boolean(key))
  )
  const nextCandidateByKey = new Map(
    nextCandidateRules.map((rule) => [brainRuleKey(rule), rule]).filter(([key]) => Boolean(key))
  )

  const activeMap = new Map(
    nextActiveRules.map((rule) => [brainRuleKey(rule), rule]).filter(([key]) => Boolean(key))
  )
  const candidateMap = new Map(
    nextCandidateRules.map((rule) => [brainRuleKey(rule), rule]).filter(([key]) => Boolean(key))
  )

  const resolveBaseRule = (auditItem) => {
    const key = auditItem?.id || auditItem?.text || ''
    return nextActiveByKey.get(key) || nextCandidateByKey.get(key) || currentByKey.get(key) || null
  }

  coveredAudit.validatedRules.forEach((auditItem) => {
    const rule = applyAuditToBrainRule(resolveBaseRule(auditItem), auditItem, { status: 'active' })
    if (!rule) return
    const key = brainRuleKey(rule)
    candidateMap.delete(key)
    activeMap.set(key, rule)
  })

  coveredAudit.staleRules.forEach((auditItem) => {
    const baseRule = resolveBaseRule(auditItem)
    const targetStatus = baseRule?.status === 'candidate' ? 'candidate' : 'active'
    const rule = applyAuditToBrainRule(baseRule, auditItem, { status: targetStatus })
    if (!rule) return
    const key = brainRuleKey(rule)
    if (targetStatus === 'candidate') {
      activeMap.delete(key)
      candidateMap.set(key, rule)
    } else {
      activeMap.set(key, rule)
      candidateMap.delete(key)
    }
  })

  coveredAudit.invalidatedRules.forEach((auditItem) => {
    const baseRule = resolveBaseRule(auditItem)
    const nextStatus = auditItem?.nextStatus || 'candidate'
    const auditKey = (auditItem?.id || auditItem?.text || '').trim()
    const baseKey = brainRuleKey(baseRule)
    if (nextStatus === 'archived') {
      if (auditKey) {
        activeMap.delete(auditKey)
        candidateMap.delete(auditKey)
      }
      if (baseKey) {
        activeMap.delete(baseKey)
        candidateMap.delete(baseKey)
      }
      return
    }
    const rule = applyAuditToBrainRule(baseRule, auditItem, {
      status: 'candidate',
      defaultStatus: 'candidate',
    })
    if (!rule) return
    const ruleKey = brainRuleKey(rule)
    activeMap.delete(ruleKey)
    candidateMap.set(ruleKey, rule)
  })

  const merged = {
    version: 4,
    rules: Array.from(activeMap.values()).sort(compareBrainRulesByStrength).slice(0, 12),
    candidateRules: Array.from(candidateMap.values()).sort(compareBrainRulesByStrength).slice(0, 8),
    checklists: Object.prototype.hasOwnProperty.call(nextBrain || {}, 'checklists')
      ? normalizedNext.checklists || createEmptyBrainChecklists()
      : normalizeBrainChecklists(normalizedCurrent.checklists, [
          ...Array.from(activeMap.values()),
          ...Array.from(candidateMap.values()),
        ]),
    lessons: Object.prototype.hasOwnProperty.call(nextBrain || {}, 'lessons')
      ? normalizedNext.lessons || []
      : normalizedCurrent.lessons || [],
    commonMistakes: Object.prototype.hasOwnProperty.call(nextBrain || {}, 'commonMistakes')
      ? normalizedNext.commonMistakes || []
      : normalizedCurrent.commonMistakes || [],
    stats: Object.prototype.hasOwnProperty.call(nextBrain || {}, 'stats')
      ? normalizedNext.stats || {}
      : normalizedCurrent.stats || {},
    lastUpdate: Object.prototype.hasOwnProperty.call(nextBrain || {}, 'lastUpdate')
      ? normalizedNext.lastUpdate || null
      : normalizedCurrent.lastUpdate || null,
    coachLessons:
      (normalizedNext.coachLessons || []).length > 0
        ? normalizedNext.coachLessons
        : normalizedCurrent.coachLessons || [],
    evolution: Object.prototype.hasOwnProperty.call(nextBrain || {}, 'evolution')
      ? normalizedNext.evolution || ''
      : normalizedCurrent.evolution || '',
  }

  return normalizeStrategyBrain(merged, { allowEmpty: true })
}
