import {
  MARKET_PRICE_CACHE_KEY,
  MARKET_PRICE_SYNC_KEY,
  OWNER_PORTFOLIO_ID,
  PORTFOLIOS_KEY,
} from '../constants.js'
import { normalizeStrategyBrain } from './brainRuntime.js'
import {
  formatTaiwanValidationSignalLabel,
  normalizeFundamentalsStore,
  normalizeHoldingDossiers,
} from './dossierUtils.js'
import { getEventStockCodes, isClosedEvent, normalizeNewsEvents } from './eventUtils.js'
import {
  applyMarketQuotesToHoldings,
  getHoldingCostBasis,
  getHoldingMarketValue,
  getHoldingUnrealizedPnl,
  normalizeHoldings,
} from './holdings.js'
import { normalizeMarketPriceCache, normalizeMarketPriceSync } from './market.js'
import {
  AUTHORITATIVE_PRICE_KEY,
  mergeAuthoritativeIntoPriceCache,
} from './authoritativePriceMirror'

import {
  buildPortfoliosFromStorage,
  clonePortfolioNotes,
  collectPortfolioBackupStorage,
  getPortfolioFallback,
  normalizePortfolios,
  pfKey,
} from './portfolioUtils.js'
import {
  normalizeAnalysisHistoryEntries,
  normalizeAnalystReportsStore,
  normalizeDailyReportEntry,
} from './reportUtils.js'
import { normalizeWatchlist } from './watchlistUtils.js'

// ─────────────────────────────────────────────────────────────
// 模組層快取：避免每次 setter → 14× JSON.parse + 14× normalize
// 每個 storage key 記住 (raw, normalized)，raw 字串相同就回傳同一個 normalized reference
// 這讓子層 useMemo（HoldingsTable、ResearchPanel 等）的依賴比較不會誤判而重算
// ─────────────────────────────────────────────────────────────
const __fieldCache = new Map() // storageKey -> { raw, parsed, normalized }
const __snapshotCache = new Map() // portfolioId -> { signature, snapshot }

function readRawString(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function readCachedField(key, normalize) {
  const raw = readRawString(key)
  const cached = __fieldCache.get(key)
  if (cached && cached.raw === raw && cached.normalize === normalize) return cached.normalized
  let parsed
  if (raw == null) {
    parsed = undefined
  } else {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = raw
    }
  }
  const normalized = normalize(parsed)
  __fieldCache.set(key, { raw, parsed, normalized, normalize })
  return normalized
}

export function invalidateRouteRuntimeCache(key) {
  if (key) __fieldCache.delete(key)
  else __fieldCache.clear()
  __snapshotCache.clear()
}

const __identity = (v) => v

function readPortfolioField(portfolioId, suffix, normalize = __identity) {
  const key = pfKey(portfolioId, suffix)
  const value = readCachedField(key, normalize)
  if (value === undefined) {
    const fallback = getPortfolioFallback(portfolioId, suffix)
    return normalize === __identity ? fallback : normalize(fallback)
  }
  return value
}

const __arrayOrEmpty = (v) => (Array.isArray(v) ? v : [])
const __objectOrEmpty = (v) => (v && typeof v === 'object' ? v : {})
const __strategyBrainNormalize = (v) => normalizeStrategyBrain(v, { allowEmpty: true })
const __portfolioNotesNormalize = (v) => ({ ...clonePortfolioNotes(), ...(v || {}) })

let __cachedMarketState = null
let __cachedMarketRawCache = null
let __cachedMarketRawSync = null
let __cachedMarketRawAuthoritative = null

export function readRouteMarketState() {
  const rawCache = readRawString(MARKET_PRICE_CACHE_KEY)
  const rawSync = readRawString(MARKET_PRICE_SYNC_KEY)
  const rawAuthoritative = readRawString(AUTHORITATIVE_PRICE_KEY)
  if (
    __cachedMarketState &&
    rawCache === __cachedMarketRawCache &&
    rawSync === __cachedMarketRawSync &&
    rawAuthoritative === __cachedMarketRawAuthoritative
  ) {
    return __cachedMarketState
  }
  const legacyCache = readCachedField(MARKET_PRICE_CACHE_KEY, normalizeMarketPriceCache)
  const marketPriceSync = readCachedField(MARKET_PRICE_SYNC_KEY, normalizeMarketPriceSync)
  // Phase 7 — DB 權威價覆蓋 legacy TWSE/LocalStorage 快取（單一價格真相）。
  const marketPriceCache = mergeAuthoritativeIntoPriceCache(legacyCache)
  __cachedMarketRawCache = rawCache
  __cachedMarketRawSync = rawSync
  __cachedMarketRawAuthoritative = rawAuthoritative
  __cachedMarketState = {
    marketPriceCache,
    marketPriceSync,
    lastUpdate: marketPriceSync?.syncedAt ? new Date(marketPriceSync.syncedAt) : null,
  }
  return __cachedMarketState
}


export function readRuntimePortfolios() {
  const storedPortfolios = readCachedField(PORTFOLIOS_KEY, __identity)
  if (Array.isArray(storedPortfolios) && storedPortfolios.length > 0) {
    return normalizePortfolios(storedPortfolios)
  }
  return normalizePortfolios(buildPortfoliosFromStorage(collectPortfolioBackupStorage()))
}

export function readPortfolioRuntimeSnapshot(portfolioId, { marketPriceCache = null } = {}) {
  const activePortfolioId = String(portfolioId || OWNER_PORTFOLIO_ID).trim() || OWNER_PORTFOLIO_ID
  const activeMarketPriceCache = marketPriceCache || readRouteMarketState().marketPriceCache
  const priceMap = activeMarketPriceCache?.prices || null

  // 用 (portfolioId + 各 raw 字串 + marketCache identity) 當簽章，
  // 完全一致就回上次同一個 snapshot，讓 outletContext useMemo 不會誤失效
  const sig =
    activePortfolioId +
    '|' +
    (priceMap ? Object.keys(priceMap).length + ':' + (activeMarketPriceCache.syncedAt || '') : '0') +
    '|' +
    [
      'holdings-v2',
      'watchlist-v1',
      'targets-v1',
      'fundamentals-v1',
      'analyst-reports-v1',
      'holding-dossiers-v1',
      'news-events-v1',
      'analysis-history-v1',
      'daily-report-v1',
      'research-history-v1',
      'log-v2',
      'reversal-v1',
      'brain-v1',
      'notes-v1',
    ]
      .map((s) => readRawString(pfKey(activePortfolioId, s)) || '')
      .join('§')

  const cachedSnapshot = __snapshotCache.get(activePortfolioId)
  if (cachedSnapshot && cachedSnapshot.signature === sig) return cachedSnapshot.snapshot

  const rawHoldings = readPortfolioField(activePortfolioId, 'holdings-v2')
  const holdings = applyMarketQuotesToHoldings(normalizeHoldings(rawHoldings, priceMap), priceMap)

  const snapshot = {
    portfolioId: activePortfolioId,
    holdings,
    watchlist: readPortfolioField(activePortfolioId, 'watchlist-v1', normalizeWatchlist),
    targets: readPortfolioField(activePortfolioId, 'targets-v1', __objectOrEmpty),
    fundamentals: readPortfolioField(activePortfolioId, 'fundamentals-v1', normalizeFundamentalsStore),
    analystReports: readPortfolioField(
      activePortfolioId,
      'analyst-reports-v1',
      normalizeAnalystReportsStore
    ),
    holdingDossiers: readPortfolioField(
      activePortfolioId,
      'holding-dossiers-v1',
      normalizeHoldingDossiers
    ),
    newsEvents: readPortfolioField(activePortfolioId, 'news-events-v1', normalizeNewsEvents),
    analysisHistory: readPortfolioField(
      activePortfolioId,
      'analysis-history-v1',
      normalizeAnalysisHistoryEntries
    ),
    dailyReport: readPortfolioField(activePortfolioId, 'daily-report-v1', normalizeDailyReportEntry),
    researchHistory: readPortfolioField(activePortfolioId, 'research-history-v1', __arrayOrEmpty),
    tradeLog: readPortfolioField(activePortfolioId, 'log-v2', __arrayOrEmpty),
    reversalConditions: readPortfolioField(activePortfolioId, 'reversal-v1', __objectOrEmpty),
    strategyBrain: readPortfolioField(activePortfolioId, 'brain-v1', __strategyBrainNormalize),
    portfolioNotes: readPortfolioField(activePortfolioId, 'notes-v1', __portfolioNotesNormalize),
  }

  __snapshotCache.set(activePortfolioId, { signature: sig, snapshot })
  return snapshot
}

function buildPortfolioSummary(portfolio, snapshot) {
  const holdings = Array.isArray(snapshot?.holdings) ? snapshot.holdings : []
  const pendingEvents = (Array.isArray(snapshot?.newsEvents) ? snapshot.newsEvents : []).filter(
    (event) => !isClosedEvent(event)
  )
  const totalValue = holdings.reduce((sum, item) => sum + getHoldingMarketValue(item), 0)
  const totalCost = holdings.reduce((sum, item) => sum + getHoldingCostBasis(item), 0)
  const totalPnl = totalValue - totalCost
  const retPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0

  return {
    ...portfolio,
    holdings,
    newsEvents: snapshot?.newsEvents || [],
    notes: snapshot?.portfolioNotes || clonePortfolioNotes(),
    pendingEvents,
    holdingCount: holdings.length,
    totalValue,
    totalPnl,
    retPct,
  }
}

export function buildPortfolioSummariesFromStorage({
  portfolios = null,
  marketPriceCache = null,
} = {}) {
  const runtimePortfolios =
    Array.isArray(portfolios) && portfolios.length > 0
      ? normalizePortfolios(portfolios)
      : readRuntimePortfolios()

  return runtimePortfolios.map((portfolio) =>
    buildPortfolioSummary(
      portfolio,
      readPortfolioRuntimeSnapshot(portfolio.id, { marketPriceCache })
    )
  )
}

export function buildOverviewRuntimeData({ portfolios = null, marketPriceCache = null } = {}) {
  const portfolioSummaries = buildPortfolioSummariesFromStorage({ portfolios, marketPriceCache })

  const overviewDuplicateHoldingsByCode = new Map()
  const overviewPendingItems = []

  for (const portfolio of portfolioSummaries) {
    for (const holding of portfolio.holdings || []) {
      const existing = overviewDuplicateHoldingsByCode.get(holding.code) || {
        code: holding.code,
        name: holding.name,
        totalValue: 0,
        portfolios: [],
      }
      existing.totalValue += getHoldingMarketValue(holding)
      existing.portfolios.push({
        id: portfolio.id,
        name: portfolio.name,
        qty: Number(holding.qty) || 0,
        pnl: getHoldingUnrealizedPnl(holding),
      })
      overviewDuplicateHoldingsByCode.set(holding.code, existing)
    }

    for (const event of portfolio.pendingEvents || []) {
      overviewPendingItems.push({
        id: event.id,
        portfolioId: portfolio.id,
        portfolioName: portfolio.name,
        title: event.title,
        date: event.eventDate || event.date || event.trackingStart || null,
        pred: event.pred,
        predReason: event.predReason,
      })
    }
  }

  return {
    overviewPortfolios: portfolioSummaries.map((portfolio) => ({
      ...portfolio,
      pendingEvents: portfolio.pendingEvents.length,
    })),
    overviewTotalValue: portfolioSummaries.reduce(
      (sum, portfolio) => sum + portfolio.totalValue,
      0
    ),
    overviewTotalPnl: portfolioSummaries.reduce((sum, portfolio) => sum + portfolio.totalPnl, 0),
    overviewDuplicateHoldings: Array.from(overviewDuplicateHoldingsByCode.values())
      .filter((item) => item.portfolios.length > 1)
      .sort((a, b) => b.portfolios.length - a.portfolios.length || b.totalValue - a.totalValue),
    overviewPendingItems: overviewPendingItems.sort((a, b) =>
      String(a.date || '').localeCompare(String(b.date || ''))
    ),
  }
}

export function buildHoldingAlertSummary(holdings = []) {
  const alertItems = (Array.isArray(holdings) ? holdings : [])
    .filter((item) => typeof item?.alert === 'string' && item.alert.trim())
    .map((item) => {
      const cleaned = item.alert.replace(/^⚡\s*/, '').trim()
      return cleaned ? `${item.name} ${cleaned}` : null
    })
    .filter(Boolean)

  return {
    urgentCount: alertItems.length,
    todayAlertSummary:
      alertItems.length > 2
        ? `${alertItems.slice(0, 2).join(' · ')} · 另有 ${alertItems.length - 2} 項提醒`
        : alertItems.join(' · ') || '無事件',
  }
}

export function buildWatchlistRows({ watchlist = [], newsEvents = [] } = {}) {
  return (Array.isArray(watchlist) ? watchlist : []).map((item, index) => {
    const relatedEvents = (Array.isArray(newsEvents) ? newsEvents : []).filter((event) =>
      getEventStockCodes(event).includes(item.code)
    )
    const trackingCount = relatedEvents.filter((event) => event.status === 'tracking').length
    const pendingCount = relatedEvents.filter((event) => event.status === 'pending').length
    const hits = relatedEvents.filter((event) => event.actual === event.pred).length
    const misses = relatedEvents.filter(
      (event) => event.actual && event.pred && event.actual !== event.pred
    ).length
    const upside =
      item.price > 0 && item.target > 0 ? ((item.target - item.price) / item.price) * 100 : null
    const primaryEvent =
      relatedEvents.find((event) => event.status === 'tracking') ||
      relatedEvents.find((event) => event.status === 'pending') ||
      relatedEvents[0] ||
      null

    return {
      item,
      index,
      relatedEvents,
      trackingCount,
      pendingCount,
      hits,
      misses,
      upside,
      summary: primaryEvent?.title || item.catalyst || item.note || '持續觀察',
      action:
        trackingCount > 0
          ? '目前已進入追蹤期，優先看事件驗證與價格反應。'
          : pendingCount > 0
            ? '先保留觀察，等催化落地再決定是否加大部位。'
            : item.note || '暫列觀察名單，等待新的催化訊號。',
    }
  })
}

export function buildResearchRefreshRows({ holdings = [], targets = {}, fundamentals = {} } = {}) {
  return (Array.isArray(holdings) ? holdings : [])
    .map((holding) => {
      const targetEntry = targets?.[holding.code]
      const fundamentalEntry = fundamentals?.[holding.code]
      const targetStatus = targetEntry?.targetPrice ? '已補' : '缺少'
      const fundamentalStatus = fundamentalEntry?.updatedAt
        ? formatTaiwanValidationSignalLabel({ status: 'fresh' })
        : formatTaiwanValidationSignalLabel({ status: 'missing' })
      const needsRefresh = targetStatus !== '已補' || fundamentalStatus !== '新鮮'
      return {
        code: holding.code,
        name: holding.name,
        targetStatus,
        fundamentalStatus,
        needsRefresh,
      }
    })
    .filter((item) => item.needsRefresh)
}
