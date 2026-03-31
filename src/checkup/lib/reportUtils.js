import { HISTORY_ENTRY_LIMIT } from '../constants.js'
import { normalizeBrainAuditBuckets } from './brainRuntime.js'
import { parseFlexibleDate } from './datetime.js'

function toSlashDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}/${month}/${day}`
}

export function normalizeDailyReportEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return {
    ...value,
    eventAssessments: Array.isArray(value.eventAssessments) ? value.eventAssessments : [],
    brainAudit: normalizeBrainAuditBuckets(value.brainAudit),
  }
}

export function normalizeAnalysisHistoryEntries(entries) {
  if (!Array.isArray(entries)) return []
  const byKey = new Map()
  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return
    const normalizedEntry = normalizeDailyReportEntry(entry)
    const key = entry.date ? `date:${entry.date}` : `id:${entry.id ?? Math.random()}`
    const prev = byKey.get(key)
    const entryId = Number(normalizedEntry?.id) || 0
    const prevId = Number(prev?.id) || 0
    if (!prev || entryId >= prevId) {
      byKey.set(key, normalizedEntry)
    }
  })
  return Array.from(byKey.values())
    .sort((a, b) => (Number(b?.id) || 0) - (Number(a?.id) || 0))
    .slice(0, HISTORY_ENTRY_LIMIT)
}

export function normalizeAnalystReportItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = String(value.id || '').trim()
  const title = String(value.title || '').trim()
  const url = String(value.url || '').trim()
  if (!id || !title) return null

  const target = Number(value.target)
  const confidence = Number(value.confidence)

  return {
    id,
    title,
    url,
    source: String(value.source || '').trim(),
    publishedAt: String(value.publishedAt || '').trim() || null,
    snippet: String(value.snippet || '').trim(),
    summary: String(value.summary || '').trim(),
    firm: String(value.firm || '').trim(),
    target: Number.isFinite(target) && target > 0 ? target : null,
    stance: ['bullish', 'neutral', 'bearish', 'unknown'].includes(value.stance)
      ? value.stance
      : 'unknown',
    tags: Array.isArray(value.tags) ? value.tags.filter(Boolean).slice(0, 5) : [],
    confidence: Number.isFinite(confidence) ? confidence : null,
    extractedAt: String(value.extractedAt || '').trim() || null,
    hash: String(value.hash || id).trim(),
  }
}

export function normalizeAnalystReportsStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .map(([code, entry]) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
        const items = Array.isArray(entry.items)
          ? entry.items.map(normalizeAnalystReportItem).filter(Boolean)
          : []
        const latestPublishedAt = String(entry.latestPublishedAt || '').trim() || null
        const latestTargetAt = String(entry.latestTargetAt || '').trim() || null
        return [
          code,
          {
            items,
            latestPublishedAt,
            latestTargetAt,
            lastCheckedAt: String(entry.lastCheckedAt || '').trim() || null,
          },
        ]
      })
      .filter(Boolean)
  )
}

export function normalizeReportRefreshMeta(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const normalized = {}
  for (const [code, entry] of Object.entries(value)) {
    if (code === '__daily') {
      normalized.__daily = {
        date: String(entry?.date || '').trim() || null,
        processedCodes: Array.isArray(entry?.processedCodes)
          ? entry.processedCodes.filter(Boolean)
          : [],
        runCount: Number(entry?.runCount) || 0,
        lastRunAt: String(entry?.lastRunAt || '').trim() || null,
      }
      continue
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    normalized[code] = {
      lastCheckedAt: String(entry.lastCheckedAt || '').trim() || null,
      lastChangedAt: String(entry.lastChangedAt || '').trim() || null,
      lastStatus: String(entry.lastStatus || '').trim() || 'idle',
      lastMessage: String(entry.lastMessage || '').trim() || '',
      lastHashes: Array.isArray(entry.lastHashes)
        ? entry.lastHashes.filter(Boolean).slice(0, 20)
        : [],
      checkedDate: String(entry.checkedDate || '').trim() || null,
    }
  }
  return normalized
}

export function mergeAnalystReportItems(existingItems, nextItems) {
  const merged = [...(Array.isArray(existingItems) ? existingItems : [])]
  ;(Array.isArray(nextItems) ? nextItems : []).forEach((item) => {
    const normalized = normalizeAnalystReportItem(item)
    if (!normalized) return
    const idx = merged.findIndex(
      (existing) => existing.id === normalized.id || existing.hash === normalized.hash
    )
    if (idx >= 0) merged[idx] = { ...merged[idx], ...normalized }
    else merged.push(normalized)
  })
  return merged
    .sort((a, b) => {
      const aTime = parseFlexibleDate(a.publishedAt || a.extractedAt || 0)?.getTime() || 0
      const bTime = parseFlexibleDate(b.publishedAt || b.extractedAt || 0)?.getTime() || 0
      return bTime - aTime
    })
    .slice(0, 12)
}

export function formatAnalystReportSummary(items, limit = 2) {
  const rows = (Array.isArray(items) ? items : [])
    .map((item) => {
      const summary = item.summary || item.title
      const source = item.firm || item.source || '公開來源'
      const target = item.target ? ` 目標價 ${item.target}` : ''
      return `${source}${target}：${summary}`
    })
    .filter(Boolean)
  return rows.length > 0 ? rows.slice(0, limit).join('；') : '無'
}

export function mergeTargetReports(existingReports, incomingReports) {
  const merged = [...(Array.isArray(existingReports) ? existingReports : [])]
  ;(Array.isArray(incomingReports) ? incomingReports : []).forEach((report) => {
    const firm = String(report?.firm || '').trim()
    const date = String(report?.date || '').trim()
    const target = Number(report?.target)
    if (!firm || !Number.isFinite(target) || target <= 0) return
    const normalized = { firm, target, date: date || toSlashDate() }
    const idx = merged.findIndex(
      (item) => item?.firm === normalized.firm && String(item?.date || '') === normalized.date
    )
    if (idx >= 0) merged[idx] = normalized
    else merged.push(normalized)
  })
  return merged
}

export function averageTargetFromEntry(entry) {
  const reports = Array.isArray(entry?.reports) ? entry.reports : []
  const targets = reports
    .map((report) => Number(report?.target))
    .filter((value) => Number.isFinite(value) && value > 0)
  if (targets.length === 0) return null
  return Math.round(targets.reduce((sum, value) => sum + value, 0) / targets.length)
}

export function extractResearchConclusion(report) {
  const lastRound =
    Array.isArray(report?.rounds) && report.rounds.length > 0
      ? report.rounds[report.rounds.length - 1]
      : null
  const content = typeof lastRound?.content === 'string' ? lastRound.content : ''
  const match = content.match(/(?:結論|建議|策略)[：:]\s*(.{0,300})/)
  return (match?.[1] || content.slice(0, 300) || '').trim()
}

export function summarizeTargetReportsForPrompt(reports, limit = 2) {
  const rows = (Array.isArray(reports) ? reports : [])
    .map((report) => {
      const firm = report?.firm || '未署名'
      const target = Number(report?.target)
      const date = report?.date || '日期未知'
      if (!Number.isFinite(target) || target <= 0) return null
      return `${firm} ${target} (${date})`
    })
    .filter(Boolean)
  return rows.length > 0 ? rows.slice(0, limit).join('；') : '無'
}
