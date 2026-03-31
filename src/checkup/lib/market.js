import { MARKET_PRICE_CACHE_KEY } from '../constants.js'

export { canRunPostClosePriceSync } from './datetime.js'

export function createEmptyMarketPriceCache() {
  return {
    marketDate: null,
    syncedAt: null,
    source: 'twse',
    status: 'idle',
    prices: {},
  }
}

export function normalizeMarketPriceCache(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const prices = Object.fromEntries(
    Object.entries(value.prices || {})
      .map(([code, quote]) => {
        if (!quote || typeof quote !== 'object' || Array.isArray(quote)) return null
        const price = Number(quote.price)
        const yesterday = Number(quote.yesterday)
        const change = Number(quote.change)
        const changePct = Number(quote.changePct)
        if (!Number.isFinite(price) || price <= 0) return null
        return [
          code,
          {
            price,
            yesterday: Number.isFinite(yesterday) && yesterday > 0 ? yesterday : null,
            change: Number.isFinite(change) ? change : 0,
            changePct: Number.isFinite(changePct) ? changePct : 0,
          },
        ]
      })
      .filter(Boolean)
  )

  const normalized = {
    ...createEmptyMarketPriceCache(),
    marketDate: typeof value.marketDate === 'string' ? value.marketDate : null,
    syncedAt: typeof value.syncedAt === 'string' ? value.syncedAt : null,
    source: typeof value.source === 'string' ? value.source : 'twse',
    status: typeof value.status === 'string' ? value.status : 'idle',
    prices,
  }

  return normalized.marketDate || normalized.syncedAt || Object.keys(normalized.prices).length > 0
    ? normalized
    : null
}

export function normalizeMarketPriceSync(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const normalized = {
    marketDate: typeof value.marketDate === 'string' ? value.marketDate : null,
    syncedAt: typeof value.syncedAt === 'string' ? value.syncedAt : null,
    status: typeof value.status === 'string' ? value.status : 'idle',
    codes: Array.isArray(value.codes) ? value.codes.filter(Boolean) : [],
    failedCodes: Array.isArray(value.failedCodes) ? value.failedCodes.filter(Boolean) : [],
  }
  return normalized.marketDate ||
    normalized.syncedAt ||
    normalized.codes.length > 0 ||
    normalized.failedCodes.length > 0
    ? normalized
    : null
}

export function getCachedQuotesForCodes(cache, codes) {
  const priceCache = normalizeMarketPriceCache(cache)
  if (!priceCache || !priceCache.prices) return {}
  const codeSet = new Set((codes || []).map((code) => String(code || '').trim()).filter(Boolean))
  if (codeSet.size === 0) return {}
  return Object.fromEntries(
    Object.entries(priceCache.prices).filter(([code, quote]) => codeSet.has(code) && quote?.price)
  )
}

export function getPersistedMarketQuotes() {
  try {
    const raw = localStorage.getItem(MARKET_PRICE_CACHE_KEY)
    if (raw == null) return null
    return normalizeMarketPriceCache(JSON.parse(raw))?.prices || null
  } catch {
    return null
  }
}

export function getCurrentPrice(code, quotes, fallbackPrice = null) {
  if (!code || !quotes || typeof quotes !== 'object') {
    return fallbackPrice != null ? Number(fallbackPrice) : 0
  }

  const quote = quotes[String(code).trim()]
  if (quote && Number.isFinite(quote.price) && quote.price > 0) {
    return quote.price
  }

  return fallbackPrice != null ? Number(fallbackPrice) : 0
}

export function getPriceChangePct(code, quotes) {
  if (!code || !quotes || typeof quotes !== 'object') return 0

  const quote = quotes[String(code).trim()]
  if (quote && Number.isFinite(quote.changePct)) {
    return quote.changePct
  }

  return 0
}

export function getPriceStatus(code, quotes) {
  if (!code || !quotes || typeof quotes !== 'object') return 'flat'

  const quote = quotes[String(code).trim()]
  if (!quote) return 'flat'

  const change = Number(quote.change) || 0
  if (change > 0) return 'up'
  if (change < 0) return 'down'
  return 'flat'
}

export function extractBestPrice(item) {
  const tryParse = (value) => {
    const parsed = parseFloat(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }
  return tryParse(item?.z) || tryParse(item?.h) || tryParse(item?.o) || tryParse(item?.y) || null
}

export function extractYesterday(item) {
  const parsed = parseFloat(item?.y)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
