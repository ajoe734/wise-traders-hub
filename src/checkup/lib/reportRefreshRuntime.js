import { APP_LABELS, APP_STATUS_MESSAGES } from './appMessages.js'
import {
  mergeAnalystReportItems,
  normalizeAnalystReportItem,
  normalizeAnalystReportsStore,
  normalizeReportRefreshMeta,
} from './reportUtils.js'

export function extractStructuredResearchRefreshPlan(payload) {
  if (!payload || typeof payload !== 'object') {
    return { code: '', fundamentals: null, reports: [] }
  }

  return {
    code: String(payload.code || '').trim(),
    fundamentals:
      payload.fundamentals && typeof payload.fundamentals === 'object'
        ? payload.fundamentals
        : null,
    reports: Array.isArray(payload.targets?.reports) ? payload.targets.reports : [],
  }
}

export function getResearchReportText(report) {
  return (Array.isArray(report?.rounds) ? report.rounds : [])
    .map((round, index) => `## Round ${index + 1} ${round?.title || ''}\n${round?.content || ''}`)
    .join('\n\n')
}

export function buildResearchExtractRequest({ report, targetStock, dossier, todayLabel }) {
  return {
    report: {
      code: targetStock.code,
      name: report?.name || targetStock.name,
      date: report?.date || todayLabel,
      text: getResearchReportText(report),
    },
    stock: {
      code: targetStock.code,
      name: targetStock.name,
      price: targetStock.price,
      cost: targetStock.cost,
      qty: targetStock.qty,
    },
    dossier,
  }
}

export function mergeAnalystReportBatchStore(
  store,
  code,
  payload,
  { nowIso = new Date().toISOString() } = {}
) {
  const normalizedCode = String(code || '').trim()
  if (!normalizedCode || !payload || typeof payload !== 'object') {
    return { nextStore: normalizeAnalystReportsStore(store), incomingItems: [] }
  }

  const current = normalizeAnalystReportsStore(store)
  const existing = current[normalizedCode] || {
    items: [],
    latestPublishedAt: null,
    latestTargetAt: null,
    lastCheckedAt: null,
  }
  const incomingItems = Array.isArray(payload.items)
    ? payload.items.map(normalizeAnalystReportItem).filter(Boolean)
    : []
  const mergedItems = mergeAnalystReportItems(existing.items, incomingItems)
  const latestPublishedAt = mergedItems[0]?.publishedAt || existing.latestPublishedAt || null
  const latestTargetItem = mergedItems.find((item) => Number.isFinite(item?.target))
  const fetchedAt = payload.fetchedAt || nowIso

  return {
    incomingItems,
    fetchedAt,
    nextStore: {
      ...current,
      [normalizedCode]: {
        items: mergedItems,
        latestPublishedAt,
        latestTargetAt: latestTargetItem?.publishedAt || existing.latestTargetAt || null,
        lastCheckedAt: fetchedAt,
      },
    },
  }
}

export function mergeReportRefreshMetaStore(
  store,
  {
    code,
    todayRefreshKey,
    fetchedAt = new Date().toISOString(),
    changed = false,
    errorMessage = '',
    items = [],
    newCount = 0,
  } = {}
) {
  const normalizedCode = String(code || '').trim()
  const current = normalizeReportRefreshMeta(store)
  if (!normalizedCode) return current

  const nextProcessed = Array.from(
    new Set([...(current.__daily?.processedCodes || []), normalizedCode])
  ).slice(-20)

  return {
    ...current,
    __daily: {
      date: todayRefreshKey || current.__daily?.date || null,
      processedCodes: nextProcessed,
      runCount: (current.__daily?.runCount || 0) + 1,
      lastRunAt: fetchedAt,
    },
    [normalizedCode]: {
      lastCheckedAt: fetchedAt,
      lastChangedAt: changed ? fetchedAt : current[normalizedCode]?.lastChangedAt || null,
      lastStatus: errorMessage ? 'failed' : changed ? 'updated' : 'unchanged',
      lastMessage:
        errorMessage ||
        (changed
          ? APP_STATUS_MESSAGES.reportRefreshUpdated(newCount)
          : APP_STATUS_MESSAGES.reportRefreshNoChanges),
      lastHashes: Array.isArray(items)
        ? items.map((item) => item.id || item.hash).filter(Boolean)
        : current[normalizedCode]?.lastHashes || [],
      checkedDate: todayRefreshKey || null,
    },
  }
}

export function buildAnalystTargetUpserts(code, items, { todayLabel }) {
  const normalizedCode = String(code || '').trim()
  if (!normalizedCode) return []

  return (Array.isArray(items) ? items : [])
    .filter((item) => Number.isFinite(item?.target) && item.target > 0)
    .map((item) => ({
      code: normalizedCode,
      firm: item.firm || item.source || APP_LABELS.publicReportSource,
      target: item.target,
      date: item.publishedAt || todayLabel,
    }))
}
