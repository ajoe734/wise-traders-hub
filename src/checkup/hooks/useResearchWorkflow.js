import { useCallback } from 'react'
import { getCheckupGateway } from '../lib/gateway'
import { API_ENDPOINTS, STATUS_MESSAGE_TIMEOUT_MS } from '../constants.js'
import {
  buildResearchDossiers,
  buildResearchRequestBody,
  buildResearchStocks,
  getPrimaryResearchResult,
  getResearchTargetKey,
  mergeResearchHistoryEntries,
} from '../lib/researchRuntime.js'
// Phase 3A.4 Step 1: store 直取 setter
import { useReportsStore } from '../stores/reportsStore.js'
import { useBrainStore } from '../stores/brainStore.js'

async function defaultRunResearchRequest(body) {
  return getCheckupGateway().http.json(API_ENDPOINTS.RESEARCH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function useResearchWorkflow({
  researching = false,
  setResearching = () => {},
  setResearchTarget = () => {},
  holdings = [],
  portfolioHoldings = [],
  dossierByCode = new Map(),
  stockMeta = {},
  strategyBrain = null,
  portfolioNotes = {},
  canUseCloud = false,
  newsEvents = [],
  analysisHistory = [],
  resolveHoldingPrice = () => 0,
  getHoldingUnrealizedPnl = () => 0,
  getHoldingReturnPct = () => 0,
  setResearchResults = () => {},
  setSaved = () => {},
  flashSaved = null,
  enrichResearchToDossier = async () => false,
  mergeBrainPreservingCoachLessons = (nextBrain) => nextBrain,
  runResearchRequest = defaultRunResearchRequest,
}) {
  const setResearchHistory = useReportsStore((s) => s.setResearchHistory)
  const setStrategyBrain = useBrainStore((s) => s.setStrategyBrain)
  const emitSaved = useCallback(
    (message, timeout = STATUS_MESSAGE_TIMEOUT_MS.DEFAULT) => {
      if (typeof flashSaved === 'function') {
        flashSaved(message, timeout)
        return
      }
      setSaved(message)
      if (timeout != null) {
        setTimeout(() => setSaved(''), timeout)
      }
    },
    [flashSaved, setSaved]
  )

  const runResearch = useCallback(
    async (mode, targetStock) => {
      if (researching) return

      setResearching(true)
      setResearchTarget(getResearchTargetKey(mode, targetStock))

      try {
        const stocks = buildResearchStocks({
          mode,
          targetStock,
          holdings,
          resolveHoldingPrice,
          getHoldingUnrealizedPnl,
          getHoldingReturnPct,
        })
        const researchDossiers = buildResearchDossiers({ stocks, dossierByCode })
        const body = buildResearchRequestBody({
          mode,
          stocks,
          holdings: portfolioHoldings,
          researchDossiers,
          stockMeta,
          strategyBrain,
          portfolioNotes,
          canUseCloud,
          newsEvents,
          analysisHistory,
        })

        const data = await runResearchRequest(body, { mode, targetStock })
        const result = getPrimaryResearchResult(data)

        if (result) {
          setResearchResults(result)
          setResearchHistory((prev) => mergeResearchHistoryEntries([result], prev))

          if (mode === 'single' && result.code) {
            enrichResearchToDossier(result, { silent: true })
              .then((changed) => {
                if (!changed) return
                emitSaved(
                  '✅ 研究完成 · 已同步目標價 / 財報到持倉',
                  STATUS_MESSAGE_TIMEOUT_MS.NOTICE
                )
              })
              .catch((error) => {
                console.error('背景同步研究資料失敗:', error)
              })
          }

          if ((mode === 'evolve' || mode === 'portfolio') && result.newBrain) {
            setStrategyBrain(mergeBrainPreservingCoachLessons(result.newBrain, strategyBrain))
            emitSaved('✅ 系統進化完成 · 策略大腦已更新')
          } else {
            emitSaved('✅ 研究完成')
          }
          return result
        } else {
          emitSaved('⚠️ 研究無結果')
          return null
        }
      } catch (error) {
        console.error('AutoResearch failed:', error)
        emitSaved('❌ 研究失敗')
        return null
      } finally {
        setResearching(false)
        setResearchTarget(null)
      }
    },
    [
      analysisHistory,
      canUseCloud,
      dossierByCode,
      emitSaved,
      enrichResearchToDossier,
      getHoldingReturnPct,
      getHoldingUnrealizedPnl,
      holdings,
      mergeBrainPreservingCoachLessons,
      newsEvents,
      portfolioHoldings,
      portfolioNotes,
      researching,
      resolveHoldingPrice,
      runResearchRequest,
      setResearchHistory,
      setResearchResults,
      setResearchTarget,
      setResearching,
      setStrategyBrain,
      stockMeta,
      strategyBrain,
    ]
  )

  return { runResearch }
}
