import {
  ACTIVE_PORTFOLIO_KEY,
  APPLIED_TRADE_PATCHES_KEY,
  API_ENDPOINTS,
  BACKUP_GLOBAL_KEY_SET,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_PORTFOLIO_NOTES,
  LEGACY_STORAGE_KEYS,
  GLOBAL_SYNC_KEY_SET,
  OWNER_PORTFOLIO_ID,
  PORTFOLIO_ALIAS_TO_SUFFIX,
  PORTFOLIOS_KEY,
  PORTFOLIO_STORAGE_FIELDS,
  PORTFOLIO_SUFFIX_TO_FIELD,
  PORTFOLIO_VIEW_MODE,
  SCHEMA_VERSION_KEY,
  TRADE_BACKFILL_PATCHES,
  VIEW_MODE_KEY,
} from '../constants.js'
import { INIT_HOLDINGS_JINLIANCHENG, INIT_TARGETS_JINLIANCHENG } from '../seedData.js'
import { applyTradeEntryToHoldings, buildHoldingPriceHints, normalizeHoldings } from './holdings.js'
import { getPersistedMarketQuotes } from './market.js'
import { todayStorageDate } from './datetime.js'

export function createDefaultPortfolios() {
  return [{ id: OWNER_PORTFOLIO_ID, name: '我', isOwner: true, createdAt: todayStorageDate() }]
}

export function clonePortfolioNotes() {
  return { ...DEFAULT_PORTFOLIO_NOTES }
}

export function formatPortfolioNotesContext(notes) {
  const normalized =
    notes && typeof notes === 'object'
      ? { ...DEFAULT_PORTFOLIO_NOTES, ...notes }
      : DEFAULT_PORTFOLIO_NOTES
  const lines = [
    normalized.riskProfile ? `風險屬性：${normalized.riskProfile}` : null,
    normalized.preferences ? `操作偏好：${normalized.preferences}` : null,
    normalized.customNotes ? `自訂備註：${normalized.customNotes}` : null,
  ].filter(Boolean)
  return lines.length > 0 ? `個人備註：\n${lines.join('\n')}` : '個人備註：無'
}

export function normalizePortfolios(value) {
  const source = Array.isArray(value) ? value : []
  const normalized = []
  const seen = new Set()

  for (const item of source) {
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || seen.has(item.id))
      continue
    seen.add(item.id)
    normalized.push({
      id: item.id,
      name: item.name,
      isOwner: item.id === OWNER_PORTFOLIO_ID ? true : Boolean(item.isOwner),
      createdAt: item.createdAt || todayStorageDate(),
    })
  }

  if (!seen.has(OWNER_PORTFOLIO_ID)) {
    normalized.unshift(...createDefaultPortfolios())
  }

  return normalized.length > 0 ? normalized : createDefaultPortfolios()
}

export function pfKey(pid, suffix) {
  return `pf-${pid}-${suffix}`
}

export function getPortfolioFallback(pid, suffix) {
  const field = PORTFOLIO_SUFFIX_TO_FIELD[suffix]
  if (!field) return null
  return (pid === OWNER_PORTFOLIO_ID ? field.ownerFallback : field.emptyFallback)()
}

export async function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch (err) {
    console.warn(`localStorage load error for key "${key}":`, err)
    return fallback
  }
}

export async function save(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch (err) {
    console.warn(`localStorage save error for key "${key}":`, err)
  }
}

export async function loadAppliedTradePatches() {
  return load(APPLIED_TRADE_PATCHES_KEY, [])
}

export async function saveAppliedTradePatches(ids) {
  return save(APPLIED_TRADE_PATCHES_KEY, Array.from(new Set(ids || [])))
}

export async function applyTradeBackfillPatchesIfNeeded({
  fetchImpl = globalThis.fetch,
} = {}) {
  const applied = new Set(await loadAppliedTradePatches())
  let changed = 0

  for (const patch of TRADE_BACKFILL_PATCHES) {
    if (applied.has(patch.id)) continue

    const tradeLog = await loadPortfolioData(
      patch.portfolioId,
      PORTFOLIO_ALIAS_TO_SUFFIX.tradeLog,
      []
    )
    if ((tradeLog || []).some((item) => item?.patchId === patch.id)) {
      applied.add(patch.id)
      continue
    }

    const holdings = await loadPortfolioData(
      patch.portfolioId,
      PORTFOLIO_ALIAS_TO_SUFFIX.holdings,
      getPortfolioFallback(patch.portfolioId, PORTFOLIO_ALIAS_TO_SUFFIX.holdings)
    )
    const existing = (holdings || []).find((item) => item.code === patch.entry.code)
    const currentQty = Number(existing?.qty) || 0
    const shouldAdjustHoldings =
      patch.expectedQtyAfter == null || currentQty > patch.expectedQtyAfter

    const nextHoldings = shouldAdjustHoldings
      ? applyTradeEntryToHoldings(holdings, patch.entry, getPersistedMarketQuotes())
      : holdings
    const nextTradeLog = [patch.entry, ...(tradeLog || [])]

    await savePortfolioData(patch.portfolioId, PORTFOLIO_ALIAS_TO_SUFFIX.tradeLog, nextTradeLog)
    await savePortfolioData(patch.portfolioId, PORTFOLIO_ALIAS_TO_SUFFIX.holdings, nextHoldings)

    if (patch.portfolioId === OWNER_PORTFOLIO_ID && typeof fetchImpl === 'function') {
      try {
        await fetchImpl(API_ENDPOINTS.BRAIN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save-holdings', data: nextHoldings }),
        })
      } catch {
        // local copy is still enough; cloud can catch up later
      }
    }

    applied.add(patch.id)
    changed += 1
  }

  if (applied.size > 0) {
    await saveAppliedTradePatches(Array.from(applied))
  }

  return changed
}

export function sanitizePortfolioField(suffix, data) {
  if (suffix === 'holdings-v2') {
    return normalizeHoldings(data, getPersistedMarketQuotes())
  }
  return data
}

export const readSyncAt = (key) => {
  try {
    return Number(localStorage.getItem(key) || 0)
  } catch {
    return 0
  }
}

export const writeSyncAt = (key, value) => {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // best-effort local sync timestamp
  }
}

export async function savePortfolioData(pid, suffix, data) {
  return save(pfKey(pid, suffix), sanitizePortfolioField(suffix, data))
}

export async function loadPortfolioData(pid, suffix, fallback) {
  return sanitizePortfolioField(suffix, await load(pfKey(pid, suffix), fallback))
}

export async function loadForPortfolio(pid, suffix) {
  return loadPortfolioData(pid, suffix, getPortfolioFallback(pid, suffix))
}

export function readStorageValue(key) {
  const raw = localStorage.getItem(key)
  if (raw == null) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export function collectPortfolioBackupStorage() {
  const storage = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith('pf-')) continue
    if (GLOBAL_SYNC_KEY_SET.has(key)) continue
    if (
      !BACKUP_GLOBAL_KEY_SET.has(key) &&
      !PORTFOLIO_STORAGE_FIELDS.some((item) => key.endsWith(`-${item.suffix}`))
    )
      continue
    storage[key] = readStorageValue(key)
  }
  return storage
}

export function normalizeImportedStorageKey(rawKey) {
  if (GLOBAL_SYNC_KEY_SET.has(rawKey)) return null
  if (BACKUP_GLOBAL_KEY_SET.has(rawKey)) return rawKey
  if (PORTFOLIO_ALIAS_TO_SUFFIX[rawKey])
    return pfKey(OWNER_PORTFOLIO_ID, PORTFOLIO_ALIAS_TO_SUFFIX[rawKey])

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

export function normalizeBackupStorage(payload) {
  if (!payload) return null

  if (Array.isArray(payload)) {
    const looksLikeHistory = payload.every(
      (item) => item && typeof item === 'object' && (item.id != null || item.date || item.aiInsight)
    )
    return looksLikeHistory ? { [pfKey(OWNER_PORTFOLIO_ID, 'analysis-history-v1')]: payload } : null
  }

  if (typeof payload !== 'object') return null

  if (payload.storage && typeof payload.storage === 'object' && !Array.isArray(payload.storage)) {
    return normalizeBackupStorage(payload.storage)
  }

  const mapEntries = (source) => {
    const mapped = {}
    for (const [rawKey, value] of Object.entries(source || {})) {
      const key = normalizeImportedStorageKey(rawKey)
      if (key) mapped[key] = value
    }
    return mapped
  }

  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    const mapped = mapEntries(payload.data)
    if (Object.keys(mapped).length > 0) return mapped
  }

  const directMapped = mapEntries(payload)
  if (Object.keys(directMapped).length > 0) return directMapped

  const looksLikeBrain =
    Array.isArray(payload.rules) ||
    Array.isArray(payload.candidateRules) ||
    Array.isArray(payload.lessons) ||
    Array.isArray(payload.commonMistakes) ||
    Array.isArray(payload.coachLessons) ||
    payload.checklists ||
    payload.stats ||
    payload.evolution
  if (looksLikeBrain) return { [pfKey(OWNER_PORTFOLIO_ID, 'brain-v1')]: payload }

  const looksLikeDailyReport =
    payload.totalTodayPnl != null ||
    Array.isArray(payload.changes) ||
    typeof payload.aiInsight === 'string'
  if (looksLikeDailyReport) {
    return {
      [pfKey(OWNER_PORTFOLIO_ID, 'daily-report-v1')]: payload,
      [pfKey(OWNER_PORTFOLIO_ID, 'analysis-history-v1')]: [payload],
    }
  }

  return null
}

export function extractPortfolioIdsFromStorage(storage) {
  const ids = new Set([OWNER_PORTFOLIO_ID])
  for (const key of Object.keys(storage || {})) {
    for (const field of PORTFOLIO_STORAGE_FIELDS) {
      const suffix = `-${field.suffix}`
      if (!key.startsWith('pf-') || !key.endsWith(suffix)) continue
      const pid = key.slice(3, -suffix.length)
      if (pid) ids.add(pid)
      break
    }
  }
  return Array.from(ids)
}

export function buildPortfoliosFromStorage(storage) {
  const existing = normalizePortfolios(storage?.[PORTFOLIOS_KEY])
  const byId = new Map(existing.map((item) => [item.id, item]))
  const ids = extractPortfolioIdsFromStorage(storage)

  return ids.map(
    (id) =>
      byId.get(id) || {
        id,
        name: id === OWNER_PORTFOLIO_ID ? '我' : id,
        isOwner: id === OWNER_PORTFOLIO_ID,
        createdAt: todayStorageDate(),
      }
  )
}

export function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function migrateLegacyPortfolioStorageIfNeeded() {
  const currentVersion = await load(SCHEMA_VERSION_KEY, null)
  const hasLegacyData = LEGACY_STORAGE_KEYS.some((key) => localStorage.getItem(key) != null)
  if (currentVersion === CURRENT_SCHEMA_VERSION || !hasLegacyData) return false

  await save(PORTFOLIOS_KEY, createDefaultPortfolios())
  await save(ACTIVE_PORTFOLIO_KEY, OWNER_PORTFOLIO_ID)
  await save(VIEW_MODE_KEY, PORTFOLIO_VIEW_MODE)

  for (const field of PORTFOLIO_STORAGE_FIELDS) {
    if (field.hasLegacy === false) continue
    const legacyKey = `pf-${field.suffix}`
    const raw = localStorage.getItem(legacyKey)
    if (raw == null) continue
    await savePortfolioData(OWNER_PORTFOLIO_ID, field.suffix, readStorageValue(legacyKey))
    localStorage.removeItem(legacyKey)
  }

  const migratedEvents = await loadPortfolioData(OWNER_PORTFOLIO_ID, 'news-events-v1', [])
  if (Array.isArray(migratedEvents) && migratedEvents.length > 0) {
    await savePortfolioData(
      OWNER_PORTFOLIO_ID,
      'news-events-v1',
      migratedEvents.map((event) => ({
        ...event,
        status: event.status === 'past' ? 'closed' : event.status,
        ...(event.status === 'past'
          ? {
              eventDate: event.date,
              trackingStart: event.reviewDate || event.date,
              exitDate: event.reviewDate || null,
              priceAtEvent: null,
              priceAtExit: null,
              priceHistory: [],
            }
          : {}),
      }))
    )
  }

  await save(SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION)
  return true
}

export async function repairPersistedHoldingsIfNeeded() {
  const storage = collectPortfolioBackupStorage()
  const portfolios = buildPortfoliosFromStorage(storage)
  const quotes = getPersistedMarketQuotes()
  let repaired = 0

  for (const portfolio of portfolios) {
    const key = pfKey(portfolio.id, 'holdings-v2')
    const raw = readStorageValue(key)
    if (raw === undefined) continue
    const analysisHistory = readStorageValue(pfKey(portfolio.id, 'analysis-history-v1'))
    const fallbackRows = getPortfolioFallback(portfolio.id, 'holdings-v2')
    const priceHints = buildHoldingPriceHints({ analysisHistory, fallbackRows })
    const normalized = normalizeHoldings(raw, quotes, priceHints)
    if (JSON.stringify(raw) === JSON.stringify(normalized)) continue
    await save(key, normalized)
    repaired += 1
  }

  return repaired
}

export async function seedJinlianchengIfNeeded() {
  const portfolios = await load(PORTFOLIOS_KEY, [])
  const existing = portfolios.find((portfolio) => portfolio.name === '金聯成')
  if (existing) {
    const holdings = await loadPortfolioData(existing.id, 'holdings-v2', [])
    if (holdings.length > 0) return
    await savePortfolioData(existing.id, 'holdings-v2', INIT_HOLDINGS_JINLIANCHENG)
    await savePortfolioData(existing.id, 'targets-v1', INIT_TARGETS_JINLIANCHENG)
    return
  }

  const newPortfolio = {
    id: `p-${Date.now().toString(36)}`,
    name: '金聯成',
    isOwner: false,
    createdAt: todayStorageDate(),
  }

  await save(PORTFOLIOS_KEY, [...portfolios, newPortfolio])
  for (const field of PORTFOLIO_STORAGE_FIELDS) {
    await savePortfolioData(newPortfolio.id, field.suffix, field.emptyFallback())
  }
  await savePortfolioData(newPortfolio.id, 'holdings-v2', INIT_HOLDINGS_JINLIANCHENG)
  await savePortfolioData(newPortfolio.id, 'targets-v1', INIT_TARGETS_JINLIANCHENG)
}

export async function ensurePortfolioRegistry() {
  const storedPortfolios = await load(PORTFOLIOS_KEY, null)
  const portfolios = normalizePortfolios(storedPortfolios)
  if (!storedPortfolios || JSON.stringify(storedPortfolios) !== JSON.stringify(portfolios)) {
    await save(PORTFOLIOS_KEY, portfolios)
  }

  let activePortfolioId = await load(ACTIVE_PORTFOLIO_KEY, OWNER_PORTFOLIO_ID)
  if (
    typeof activePortfolioId !== 'string' ||
    !portfolios.some((item) => item.id === activePortfolioId)
  ) {
    activePortfolioId = OWNER_PORTFOLIO_ID
    await save(ACTIVE_PORTFOLIO_KEY, activePortfolioId)
  }

  let viewMode = await load(VIEW_MODE_KEY, PORTFOLIO_VIEW_MODE)
  if (viewMode !== PORTFOLIO_VIEW_MODE) {
    viewMode = PORTFOLIO_VIEW_MODE
    await save(VIEW_MODE_KEY, viewMode)
  }

  await repairPersistedHoldingsIfNeeded()

  const schemaVersion = await load(SCHEMA_VERSION_KEY, null)
  if (schemaVersion !== CURRENT_SCHEMA_VERSION) {
    await save(SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION)
  }

  return { portfolios, activePortfolioId, viewMode }
}

export async function loadPortfolioSnapshot(pid) {
  const snapshot = {}
  for (const field of PORTFOLIO_STORAGE_FIELDS) {
    snapshot[field.alias] = await loadForPortfolio(pid, field.suffix)
  }
  snapshot.holdings = normalizeHoldings(
    snapshot.holdings,
    getPersistedMarketQuotes(),
    buildHoldingPriceHints({
      analysisHistory: snapshot.analysisHistory,
      fallbackRows: getPortfolioFallback(pid, 'holdings-v2'),
    })
  )
  return snapshot
}
