import { useCallback } from 'react'
import { getCheckupGateway, parseGatewayErrorBody } from '../lib/gateway'
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
import { flushKnowledgeHits } from '../lib/knowledgeBase.js'

async function defaultRunStressTestRequest(body) {
  try {
    return await getCheckupGateway().http.json(API_ENDPOINTS.ANALYZE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    const detail = parseGatewayErrorBody(err)
    throw new Error(detail?.detail || detail?.error || `壓力測試失敗 (${err?.status || 0})`)
  }
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


      // 記錄壓力測試命中的知識條目（不阻擋主流程）
      flushKnowledgeHits({ context: 'stress_test' }).catch(() => {})

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
