export function getResearchTargetKey(mode, targetStock = null) {
  if (mode === 'single') return String(targetStock?.code || '').trim() || null
  return (
    String(mode || '')
      .trim()
      .toUpperCase() || null
  )
}

export function buildResearchStocks({
  mode = 'single',
  targetStock = null,
  holdings = [],
  resolveHoldingPrice = () => 0,
  getHoldingUnrealizedPnl = () => 0,
  getHoldingReturnPct = () => 0,
}) {
  if (mode === 'single' && targetStock) return [targetStock]

  return (Array.isArray(holdings) ? holdings : []).map((holding) => ({
    code: holding.code,
    name: holding.name,
    price: resolveHoldingPrice(holding),
    cost: holding.cost,
    pnl: getHoldingUnrealizedPnl(holding),
    pct: getHoldingReturnPct(holding),
    type: holding.type,
  }))
}

export function buildResearchDossiers({ stocks = [], dossierByCode = new Map() }) {
  return (Array.isArray(stocks) ? stocks : [])
    .map((stock) => {
      const dossier = dossierByCode.get(stock.code)
      if (!dossier) return null
      return {
        ...dossier,
        position: {
          ...(dossier.position || {}),
          price: stock.price,
          pnl: stock.pnl,
          pct: stock.pct,
          cost: stock.cost,
          type: stock.type || dossier.position?.type || '股票',
        },
      }
    })
    .filter(Boolean)
}

export function buildResearchRequestBody({
  mode = 'single',
  stocks = [],
  holdings = [],
  researchDossiers = [],
  stockMeta = {},
  strategyBrain = null,
  portfolioNotes = {},
  canUseCloud = false,
  newsEvents = [],
  analysisHistory = [],
}) {
  const body = {
    stocks,
    holdings,
    holdingDossiers: researchDossiers,
    meta: stockMeta,
    brain: strategyBrain,
    portfolioNotes,
    mode,
    persist: canUseCloud,
  }

  if (mode === 'evolve' || mode === 'portfolio') {
    body.events = (Array.isArray(newsEvents) ? newsEvents : []).slice(0, 20)
    body.analysisHistory = (Array.isArray(analysisHistory) ? analysisHistory : []).slice(0, 10)
  }

  return body
}

export function getPrimaryResearchResult(data) {
  return Array.isArray(data?.results) && data.results.length > 0 ? data.results[0] : null
}

export function mergeResearchHistoryEntries(existingReports, incomingReports, limit = 30) {
  return [
    ...(Array.isArray(existingReports) ? existingReports : []),
    ...(Array.isArray(incomingReports) ? incomingReports : []),
  ]
    .filter(
      (report, index, rows) =>
        rows.findIndex((item) => item?.timestamp === report?.timestamp) === index
    )
    .sort((a, b) => (Number(b?.timestamp) || 0) - (Number(a?.timestamp) || 0))
    .slice(0, limit)
}
