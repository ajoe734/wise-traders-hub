export function normalizeTrackedCodes(codes = []) {
  return Array.from(
    new Set(
      (Array.isArray(codes) ? codes : []).map((code) => String(code || '').trim()).filter(Boolean)
    )
  )
}

export function collectTrackedCodes({
  portfolios = [],
  currentActivePortfolioId = '',
  currentViewMode = '',
  liveState = {},
  readStorageValue = () => null,
  pfKey = (_pid, suffix) => suffix,
  portfolioAliasToSuffix = {},
  getEventStockCodes = () => [],
  portfolioViewMode = 'portfolio',
}) {
  const codeSet = new Set()
  const addCode = (value) => {
    const code = String(value || '').trim()
    if (code) codeSet.add(code)
  }
  const addRows = (rows) => {
    if (!Array.isArray(rows)) return
    rows.forEach((item) => addCode(item?.code))
  }
  const addEvents = (rows) => {
    if (!Array.isArray(rows)) return
    rows.forEach((event) => {
      getEventStockCodes(event).forEach((code) => addCode(code))
    })
  }

  portfolios.forEach((portfolio) => {
    const useLiveState =
      currentViewMode === portfolioViewMode && portfolio.id === currentActivePortfolioId
    const holdingRows = useLiveState
      ? liveState.holdings
      : readStorageValue(pfKey(portfolio.id, portfolioAliasToSuffix.holdings))
    const watchlistRows = useLiveState
      ? liveState.watchlist
      : readStorageValue(pfKey(portfolio.id, portfolioAliasToSuffix.watchlist))
    const eventRows = useLiveState
      ? liveState.newsEvents
      : readStorageValue(pfKey(portfolio.id, portfolioAliasToSuffix.newsEvents))

    addRows(holdingRows)
    addRows(watchlistRows)
    addEvents(eventRows)
  })

  return Array.from(codeSet)
}

export function buildTwseBatchQueries(codes = [], batchSize = 15) {
  const normalizedCodes = normalizeTrackedCodes(codes)
  const batches = []
  for (let index = 0; index < normalizedCodes.length; index += batchSize) {
    batches.push(normalizedCodes.slice(index, index + batchSize))
  }
  return batches
}

export function extractQuotesFromTwsePayload(
  payload,
  { extractBestPrice = () => null, extractYesterday = () => null } = {}
) {
  const quotes = {}
  const observedMarketDates = new Set()

  ;(payload?.msgArray || []).forEach((item) => {
    if (item?.d) observedMarketDates.add(String(item.d))
    const price = extractBestPrice(item)
    const yesterday = extractYesterday(item)
    if (!price || quotes[item.c]) return
    quotes[item.c] = {
      price,
      yesterday,
      change: yesterday ? price - yesterday : 0,
      changePct: yesterday ? (price / yesterday - 1) * 100 : 0,
    }
  })

  return {
    quotes,
    marketDate: Array.from(observedMarketDates).sort().slice(-1)[0] || null,
  }
}
