import { buildAnalysisDossiers, buildDailyChanges } from './dailyAnalysisRuntime.js'

export function buildStressTestSnapshot({
  holdings = [],
  priceMap = {},
  dossierByCode = new Map(),
  resolveHoldingPrice = () => 0,
  getHoldingUnrealizedPnl = () => 0,
  getHoldingReturnPct = () => 0,
  buildDailyHoldingDossierContext = () => '',
}) {
  const changes = buildDailyChanges({
    holdings,
    priceMap,
    resolveHoldingPrice,
    getHoldingUnrealizedPnl,
    getHoldingReturnPct,
  })

  const dailyDossiers = buildAnalysisDossiers({ changes, dossierByCode })
  const changeByCode = new Map(changes.map((change) => [change.code, change]))
  const holdingSummary =
    dailyDossiers.length > 0
      ? dailyDossiers
          .map((dossier) =>
            buildDailyHoldingDossierContext(dossier, changeByCode.get(dossier.code))
          )
          .join('\n\n')
      : '目前沒有持股 dossier。'
  const totalValue = changes.reduce(
    (sum, change) => sum + Math.round((Number(change.price) || 0) * (Number(change.qty) || 0)),
    0
  )

  return {
    changes,
    dailyDossiers,
    holdingSummary,
    totalValue,
  }
}

export function buildStressTestRequestBody({
  holdingSummary = '',
  totalValue = 0,
  buildSystemPrompt = () => '',
  buildUserPrompt = () => '',
}) {
  return {
    systemPrompt: buildSystemPrompt(),
    userPrompt: buildUserPrompt({ holdingSummary, totalValue }),
  }
}

export function getStressTestText(data, fallbackText = '') {
  return data?.content?.[0]?.text || fallbackText
}
