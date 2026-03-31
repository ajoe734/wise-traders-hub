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
  buildPortfoliosFromStorage,
  clonePortfolioNotes,
  collectPortfolioBackupStorage,
  getPortfolioFallback,
  normalizePortfolios,
  pfKey,
  readStorageValue,
} from './portfolioUtils.js'
import {
  normalizeAnalysisHistoryEntries,
  normalizeAnalystReportsStore,
  normalizeDailyReportEntry,
} from './reportUtils.js'
import { normalizeWatchlist } from './watchlistUtils.js'

function readPortfolioField(portfolioId, suffix) {
  const raw = readStorageValue(pfKey(portfolioId, suffix))
  return raw === undefined ? getPortfolioFallback(portfolioId, suffix) : raw
}

export function readRouteMarketState() {
  const marketPriceCache = normalizeMarketPriceCache(readStorageValue(MARKET_PRICE_CACHE_KEY))
  const marketPriceSync = normalizeMarketPriceSync(readStorageValue(MARKET_PRICE_SYNC_KEY))
  return {
    marketPriceCache,
    marketPriceSync,
    lastUpdate: marketPriceSync?.syncedAt ? new Date(marketPriceSync.syncedAt) : null,
  }
}

export function readRuntimePortfolios() {
  const storedPortfolios = readStorageValue(PORTFOLIOS_KEY)
  if (Array.isArray(storedPortfolios) && storedPortfolios.length > 0) {
    return normalizePortfolios(storedPortfolios)
  }
  return normalizePortfolios(buildPortfoliosFromStorage(collectPortfolioBackupStorage()))
}

export function readPortfolioRuntimeSnapshot(portfolioId, { marketPriceCache = null } = {}) {
  const activePortfolioId = String(portfolioId || OWNER_PORTFOLIO_ID).trim() || OWNER_PORTFOLIO_ID
  const activeMarketPriceCache = marketPriceCache || readRouteMarketState().marketPriceCache

  const holdings = normalizeHoldings(
    readPortfolioField(activePortfolioId, 'holdings-v2'),
    activeMarketPriceCache?.prices
  )

  return {
    portfolioId: activePortfolioId,
    holdings: applyMarketQuotesToHoldings(holdings, activeMarketPriceCache?.prices),
    watchlist: normalizeWatchlist(readPortfolioField(activePortfolioId, 'watchlist-v1')),
    targets: readPortfolioField(activePortfolioId, 'targets-v1') || {},
    fundamentals: normalizeFundamentalsStore(
      readPortfolioField(activePortfolioId, 'fundamentals-v1')
    ),
    analystReports: normalizeAnalystReportsStore(
      readPortfolioField(activePortfolioId, 'analyst-reports-v1')
    ),
    holdingDossiers: normalizeHoldingDossiers(
      readPortfolioField(activePortfolioId, 'holding-dossiers-v1')
    ),
    newsEvents: normalizeNewsEvents(readPortfolioField(activePortfolioId, 'news-events-v1')),
    analysisHistory: normalizeAnalysisHistoryEntries(
      readPortfolioField(activePortfolioId, 'analysis-history-v1')
    ),
    dailyReport: normalizeDailyReportEntry(
      readPortfolioField(activePortfolioId, 'daily-report-v1')
    ),
    researchHistory: Array.isArray(readPortfolioField(activePortfolioId, 'research-history-v1'))
      ? readPortfolioField(activePortfolioId, 'research-history-v1')
      : [],
    tradeLog: Array.isArray(readPortfolioField(activePortfolioId, 'log-v2'))
      ? readPortfolioField(activePortfolioId, 'log-v2')
      : [],
    reversalConditions: readPortfolioField(activePortfolioId, 'reversal-v1') || {},
    strategyBrain: normalizeStrategyBrain(readPortfolioField(activePortfolioId, 'brain-v1'), {
      allowEmpty: true,
    }),
    portfolioNotes: {
      ...clonePortfolioNotes(),
      ...(readPortfolioField(activePortfolioId, 'notes-v1') || {}),
    },
  }
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
