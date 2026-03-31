/**
 * Utilities - Legacy re-exports and storage helpers
 *
 * This file now re-exports from the new lib modules for backward compatibility.
 * New code should import directly from src/lib/*.
 */

// Re-export from lib modules for backward compatibility
export {
  // Holdings
  resolveHoldingPrice,
  getHoldingCostBasis,
  getHoldingMarketValue,
  getHoldingUnrealizedPnl,
  getHoldingReturnPct,
  normalizeHoldingMetrics,
  normalizeHoldingRow,
  normalizeHoldings,
  applyMarketQuotesToHoldings,
  applyTradeEntryToHoldings,
  shouldAdoptCloudHoldings,
  buildHoldingPriceHints,
  // Brain
  brainRuleText,
  brainRuleKey,
  normalizeBrainRule,
  normalizeBrainRuleStaleness,
  brainRuleStalenessLabel,
  deriveBrainRuleStaleness,
  deriveBrainRuleValidationScore,
  normalizeBrainEvidenceRef,
  normalizeBrainEvidenceRefs,
  mergeBrainEvidenceRefs,
  normalizeBrainChecklistStage,
  brainChecklistStageLabel,
  normalizeBrainAnalogCase,
  normalizeBrainAnalogCases,
  // Reports
  normalizeAnalystReportItem,
  normalizeAnalystReportsStore,
  normalizeReportRefreshMeta,
  mergeAnalystReportItems,
  formatAnalystReportSummary,
  mergeTargetReports,
  averageTargetFromEntry,
  extractResearchConclusion,
  summarizeTargetReportsForPrompt,
  // Dossiers
  normalizeFundamentalsEntry,
  normalizeFundamentalsStore,
  formatFundamentalsSummary,
  normalizeTaiwanValidationSignalStatus,
  formatTaiwanValidationSignalLabel,
  listTaiwanHardGateIssues,
  buildTaiwanHardGateEvidenceRefs,
  formatTaiwanHardGateIssueList,
  buildHoldingDossiers,
  buildEventReviewDossiers,
  buildDailyHoldingDossierContext,
  buildResearchHoldingDossierContext,
  // Date/Time
  parseStoredDate,
  parseFlexibleDate,
  todayStorageDate,
  daysSince,
  computeStaleness,
  getTaipeiClock,
  canRunPostClosePriceSync,
  formatDateTW,
  formatDateMD,
  formatTime,
  formatDateTime,
  getRelativeTime,
  // Market
  createEmptyMarketPriceCache,
  normalizeMarketPriceCache,
  normalizeMarketPriceSync,
  getCachedQuotesForCodes,
  getPersistedMarketQuotes,
  getCurrentPrice,
  getPriceChangePct,
  getPriceStatus,
} from './lib/index.js'

export { fetchJsonWithTimeout } from './lib/utils.js'

// Local imports
import {
  DEFAULT_FUNDAMENTAL_DRAFT,
  DEFAULT_NEW_EVENT,
  DEFAULT_PORTFOLIO_NOTES,
  DEFAULT_REVIEW_FORM,
  OWNER_PORTFOLIO_ID,
  PORTFOLIO_STORAGE_FIELDS,
  PORTFOLIO_SUFFIX_TO_FIELD,
  PORTFOLIOS_KEY,
  ACTIVE_PORTFOLIO_KEY,
  VIEW_MODE_KEY,
  SCHEMA_VERSION_KEY,
  GLOBAL_SYNC_KEYS,
  GLOBAL_SYNC_KEY_SET,
  BACKUP_GLOBAL_KEYS,
  BACKUP_GLOBAL_KEY_SET,
  APPLIED_TRADE_PATCHES_KEY,
  LEGACY_STORAGE_KEYS,
  CLOSED_EVENT_STATUSES,
} from './constants.js'
import { INIT_HOLDINGS, INIT_TARGETS, INIT_WATCHLIST, NEWS_EVENTS } from './seedData.js'
import {
  normalizeHoldings,
  getPersistedMarketQuotes,
  brainRuleText,
  normalizeBrainRuleStaleness,
  normalizeBrainEvidenceRefs,
  todayStorageDate,
} from './lib/index.js'

// ── Event normalization (now in lib/events.js) ─────────────────────────────

// Re-export from lib/events.js
export { normalizeEventRecord, normalizeNewsEvents } from './lib/events.js'

// ── Storage helpers ───────────────────────────────────────────────────

/**
 * Generate portfolio storage key
 */
export function pfKey(pid, suffix) {
  return `pf-${pid}-${suffix}`
}

/**
 * Get empty fallback value for a storage suffix
 */
export function getEmptyFallback(suffix) {
  const field = PORTFOLIO_SUFFIX_TO_FIELD[suffix]
  return field ? field.emptyFallback() : null
}

/**
 * Load from localStorage with fallback
 */
export async function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch (err) {
    console.warn(`localStorage load error for key "${key}":`, err)
    return fallback
  }
}

/**
 * Save to localStorage
 */
export async function save(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch (err) {
    console.warn(`localStorage save error for key "${key}":`, err)
  }
}

/**
 * Load applied trade patches
 */
export async function loadAppliedTradePatches() {
  return load(APPLIED_TRADE_PATCHES_KEY, [])
}

/**
 * Save applied trade patches
 */
export async function saveAppliedTradePatches(ids) {
  return save(APPLIED_TRADE_PATCHES_KEY, Array.from(new Set(ids || [])))
}

/**
 * Sanitize portfolio field data before persistence
 */
export function sanitizePortfolioField(suffix, data) {
  if (suffix === 'holdings-v2') {
    return normalizeHoldings(data, getPersistedMarketQuotes())
  }
  return data
}

/**
 * Collect all portfolio backup storage
 */
export function collectPortfolioBackupStorage() {
  const storage = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith('pf-')) continue

    const isGlobalKey =
      key.startsWith('pf-portfolios-v1') ||
      key.startsWith('pf-active-portfolio-v1') ||
      key.startsWith('pf-view-mode-v1') ||
      key.startsWith('pf-schema-version') ||
      key.startsWith('pf-cloud-sync-at') ||
      key.startsWith('pf-analysis-cloud-sync-at') ||
      key.startsWith('pf-research-cloud-sync-at') ||
      key.startsWith('pf-applied-trade-patches-v1')

    const isPortfolioField = PORTFOLIO_STORAGE_FIELDS.some((item) =>
      key.endsWith(`-${item.suffix}`)
    )

    if (!isGlobalKey && !isPortfolioField) continue

    const raw = localStorage.getItem(key)
    try {
      storage[key] = JSON.parse(raw)
    } catch {
      storage[key] = raw
    }
  }
  return storage
}

/**
 * Normalize imported storage key to current format
 */
export function normalizeImportedStorageKey(rawKey) {
  if (GLOBAL_SYNC_KEY_SET.has(rawKey)) return null
  if (BACKUP_GLOBAL_KEY_SET.has(rawKey)) return rawKey

  const legacyField = PORTFOLIO_STORAGE_FIELDS.find(
    (item) => item.hasLegacy !== false && `pf-${item.suffix}` === rawKey
  )
  if (legacyField) return pfKey(OWNER_PORTFOLIO_ID, legacyField.suffix)

  if (
    rawKey.startsWith('pf-') &&
    PORTFOLIO_STORAGE_FIELDS.some((item) => rawKey.endsWith(`-${item.suffix}`))
  ) {
    return rawKey
  }

  return null
}

// ── Data normalization ────────────────────────────────────────────────

/**
 * Normalize analysis history entries
 */
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
    .slice(0, 30)
}

/**
 * Normalize daily report entry
 */
export function normalizeDailyReportEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return {
    ...value,
    eventAssessments: Array.isArray(value.eventAssessments) ? value.eventAssessments : [],
    brainAudit: normalizeBrainAuditBuckets(value.brainAudit),
  }
}

/**
 * Normalize brain audit buckets
 */
export function normalizeBrainAuditBuckets(value) {
  const normalized = {
    validatedRules: [],
    staleRules: [],
    invalidatedRules: [],
  }

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

/**
 * Normalize brain audit item
 */
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

/**
 * Normalize brain audit confidence
 */
export function normalizeBrainAuditConfidence(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  if (numeric >= 0 && numeric <= 1) return Math.round(numeric * 100)
  if (numeric >= 1 && numeric <= 10) return Math.round(numeric * 10)
  return Math.max(0, Math.min(100, Math.round(numeric)))
}

// ── Factory functions ─────────────────────────────────────────────────

/**
 * Create default portfolios
 */
export function createDefaultPortfolios() {
  return [{ id: OWNER_PORTFOLIO_ID, name: '我', isOwner: true, createdAt: todayStorageDate() }]
}

/**
 * Clone portfolio notes
 */
export function clonePortfolioNotes() {
  return { ...DEFAULT_PORTFOLIO_NOTES }
}

// ── Constants re-exports ──────────────────────────────────────────────

export {
  DEFAULT_FUNDAMENTAL_DRAFT,
  DEFAULT_NEW_EVENT,
  DEFAULT_PORTFOLIO_NOTES,
  DEFAULT_REVIEW_FORM,
  INIT_HOLDINGS,
  INIT_TARGETS,
  INIT_WATCHLIST,
  NEWS_EVENTS,
  OWNER_PORTFOLIO_ID,
  PORTFOLIO_SUFFIX_TO_FIELD,
  PORTFOLIOS_KEY,
  ACTIVE_PORTFOLIO_KEY,
  VIEW_MODE_KEY,
  SCHEMA_VERSION_KEY,
  GLOBAL_SYNC_KEYS,
  GLOBAL_SYNC_KEY_SET,
  BACKUP_GLOBAL_KEYS,
  BACKUP_GLOBAL_KEY_SET,
  APPLIED_TRADE_PATCHES_KEY,
  LEGACY_STORAGE_KEYS,
  CLOSED_EVENT_STATUSES,
}
