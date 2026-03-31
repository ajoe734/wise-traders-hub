import { useCallback, useMemo, useState } from 'react'
import { STATUS_MESSAGE_TIMEOUT_MS } from '../constants.js'
import { mergeBrainPreservingCoachLessons } from '../lib/brainRuntime.js'
import {
  getHoldingReturnPct,
  getHoldingUnrealizedPnl,
  resolveHoldingPrice,
} from '../lib/holdings.js'
import { buildResearchRefreshRows } from '../lib/routeRuntime.js'
import { IND_COLOR, STOCK_META } from '../seedData.js'
import { usePortfolioRouteContext } from '../pages/usePortfolioRouteContext.js'
import { useEnrichResearchToDossier, useRefreshAnalystReports } from './api/useResearch.js'
import { useResearchWorkflow } from './useResearchWorkflow.js'

export function useRouteResearchPage() {
  const {
    portfolioId = 'me',
    holdings = [],
    targets = {},
    fundamentals = {},
    holdingDossiers = [],
    newsEvents = [],
    analysisHistory = [],
    strategyBrain = null,
    portfolioNotes = {},
    researchHistory = [],
    setResearchHistory = () => {},
    setStrategyBrain = () => {},
    flashSaved = () => {},
  } = usePortfolioRouteContext()

  const [researching, setResearching] = useState(false)
  const [researchTarget, setResearchTarget] = useState(null)
  const [researchResults, setResearchResults] = useState(null)
  const [enrichingResearchCode, setEnrichingResearchCode] = useState(null)
  const [reportRefreshing, setReportRefreshing] = useState(false)
  const [reportRefreshStatus, setReportRefreshStatus] = useState('')

  const enrichResearchToDossierMutation = useEnrichResearchToDossier()
  const refreshAnalystReportsMutation = useRefreshAnalystReports()

  const dataRefreshRows = useMemo(
    () => buildResearchRefreshRows({ holdings, targets, fundamentals }),
    [fundamentals, holdings, targets]
  )

  const dossierByCode = useMemo(
    () =>
      new Map(
        (Array.isArray(holdingDossiers) ? holdingDossiers : []).map((dossier) => [
          dossier.code,
          dossier,
        ])
      ),
    [holdingDossiers]
  )

  const enrichResearchToDossier = useCallback(
    async (results) => {
      if (!results?.code) return false
      setEnrichingResearchCode(results.code)
      try {
        await enrichResearchToDossierMutation.mutateAsync({
          portfolioId,
          code: results.code,
          researchResults: results,
        })
        return true
      } catch (error) {
        console.error('Enrich to dossier failed:', error)
        return false
      } finally {
        setEnrichingResearchCode(null)
      }
    },
    [enrichResearchToDossierMutation, portfolioId]
  )

  const { runResearch } = useResearchWorkflow({
    researching,
    setResearching,
    setResearchTarget,
    holdings,
    portfolioHoldings: holdings,
    dossierByCode,
    stockMeta: STOCK_META,
    strategyBrain,
    portfolioNotes,
    canUseCloud: false,
    newsEvents,
    analysisHistory,
    resolveHoldingPrice,
    getHoldingUnrealizedPnl,
    getHoldingReturnPct,
    setResearchResults,
    setResearchHistory,
    setStrategyBrain,
    notifySaved: flashSaved,
    enrichResearchToDossier,
    mergeBrainPreservingCoachLessons,
  })

  const refreshAnalystReports = useCallback(
    async ({ force = false } = {}) => {
      setReportRefreshing(true)
      setReportRefreshStatus('正在刷新公開報告...')
      try {
        await refreshAnalystReportsMutation.mutateAsync({ portfolioId, force })
        setReportRefreshStatus('✅ 報告已刷新')
        window.setTimeout(() => setReportRefreshStatus(''), STATUS_MESSAGE_TIMEOUT_MS.DEFAULT)
      } catch (error) {
        console.error('Refresh reports failed:', error)
        setReportRefreshStatus('❌ 刷新失敗')
        window.setTimeout(() => setReportRefreshStatus(''), STATUS_MESSAGE_TIMEOUT_MS.DEFAULT)
      } finally {
        setReportRefreshing(false)
      }
    },
    [portfolioId, refreshAnalystReportsMutation]
  )

  return useMemo(
    () => ({
      holdings,
      researching,
      researchTarget,
      reportRefreshing,
      reportRefreshStatus,
      dataRefreshRows,
      researchResults,
      researchHistory,
      enrichingResearchCode,
      STOCK_META,
      IND_COLOR,
      onEvolve: () => runResearch('evolve'),
      onRefresh: refreshAnalystReports,
      onResearch: runResearch,
      onEnrich: enrichResearchToDossier,
      onSelectHistory: setResearchResults,
    }),
    [
      dataRefreshRows,
      enrichResearchToDossier,
      enrichingResearchCode,
      holdings,
      refreshAnalystReports,
      reportRefreshing,
      reportRefreshStatus,
      researchHistory,
      researchResults,
      researchTarget,
      researching,
      runResearch,
    ]
  )
}
