import { useCallback } from 'react'
import { API_ENDPOINTS } from '../constants.js'
import { APP_STATUS_MESSAGES } from '../lib/appMessages.js'
import {
  buildStressTestSystemPrompt,
  buildStressTestUserPrompt,
} from '../lib/promptTemplateCatalog.js'
import {
  buildStressTestRequestBody,
  buildStressTestSnapshot,
  getStressTestText,
} from '../lib/stressTestRuntime.js'

async function defaultRunStressTestRequest(body) {
  const response = await fetch(API_ENDPOINTS.ANALYZE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(data?.detail || data?.error || `壓力測試失敗 (${response.status})`)
  }
  return data
}

export function useStressTestWorkflow({
  stressTesting = false,
  analyzing = false,
  setStressTesting = () => {},
  setAnalyzeStep = () => {},
  holdings = [],
  dossierByCode = new Map(),
  getMarketQuotesForCodes = async () => ({}),
  resolveHoldingPrice = () => 0,
  getHoldingUnrealizedPnl = () => 0,
  getHoldingReturnPct = () => 0,
  buildDailyHoldingDossierContext = () => '',
  toSlashDate = () => new Date().toLocaleDateString('zh-TW'),
  setStressResult = () => {},
  runStressTestRequest = defaultRunStressTestRequest,
}) {
  const runStressTest = useCallback(async () => {
    if (stressTesting || analyzing) return

    setStressTesting(true)
    setAnalyzeStep(APP_STATUS_MESSAGES.stressTesting)

    try {
      const codes = holdings.map((holding) => holding.code)
      const priceMap = await getMarketQuotesForCodes(codes)
      const { holdingSummary, totalValue } = buildStressTestSnapshot({
        holdings,
        priceMap,
        dossierByCode,
        resolveHoldingPrice,
        getHoldingUnrealizedPnl,
        getHoldingReturnPct,
        buildDailyHoldingDossierContext,
      })

      const data = await runStressTestRequest(
        buildStressTestRequestBody({
          holdingSummary,
          totalValue,
          buildSystemPrompt: buildStressTestSystemPrompt,
          buildUserPrompt: buildStressTestUserPrompt,
        }),
        { holdings, priceMap }
      )

      setStressResult({
        date: toSlashDate(),
        text: getStressTestText(data, APP_STATUS_MESSAGES.stressTestNoResult),
        totalValue,
      })
      return data
    } catch (error) {
      console.error('壓力測試失敗:', error)
      setStressResult({
        date: toSlashDate(),
        text: APP_STATUS_MESSAGES.stressTestFailed(error?.message || ''),
        totalValue: 0,
      })
      return null
    } finally {
      setStressTesting(false)
      setAnalyzeStep('')
    }
  }, [
    analyzing,
    buildDailyHoldingDossierContext,
    dossierByCode,
    getHoldingReturnPct,
    getHoldingUnrealizedPnl,
    getMarketQuotesForCodes,
    holdings,
    resolveHoldingPrice,
    runStressTestRequest,
    setAnalyzeStep,
    setStressResult,
    setStressTesting,
    stressTesting,
    toSlashDate,
  ])

  return { runStressTest }
}
