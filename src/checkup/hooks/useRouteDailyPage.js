import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRunDailyAnalysis, useRunStressTest } from './api/useAnalysis.js'
import { useBrainStore } from '../stores/brainStore.js'
import { usePortfolioRouteContext } from '../pages/usePortfolioRouteContext.js'

export function useRouteDailyPage() {
  const navigate = useNavigate()
  const {
    portfolioId = 'me',
    dailyReport,
    setDailyReport = () => {},
    analysisHistory = [],
    setAnalysisHistory = () => {},
    newsEvents = [],
    strategyBrain = null,
  } = usePortfolioRouteContext()

  const [dailyExpanded, setDailyExpanded] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeStep, setAnalyzeStep] = useState('')
  const [stressResult, setStressResult] = useState(null)
  const [stressTesting, setStressTesting] = useState(false)
  const [expandedNews, setExpandedNews] = useState(() => new Set())
  const expandedStock = useBrainStore((state) => state.expandedStock)
  const setExpandedStock = useBrainStore((state) => state.setExpandedStock)

  const runDailyAnalysisMutation = useRunDailyAnalysis()
  const runStressTestMutation = useRunStressTest()

  const runDailyAnalysis = useCallback(async () => {
    setAnalyzing(true)
    setAnalyzeStep('正在分析今日收盤數據...')
    try {
      const result = await runDailyAnalysisMutation.mutateAsync({
        portfolioId,
        data: {},
      })
      setDailyReport(result)
      setAnalysisHistory((prev) =>
        [result, ...(Array.isArray(prev) ? prev : analysisHistory)].slice(0, 30)
      )
    } catch (error) {
      console.error('Daily analysis failed:', error)
    } finally {
      setAnalyzing(false)
      setAnalyzeStep('')
    }
  }, [analysisHistory, portfolioId, runDailyAnalysisMutation, setAnalysisHistory, setDailyReport])

  const runStressTest = useCallback(async () => {
    setStressTesting(true)
    try {
      const result = await runStressTestMutation.mutateAsync({ portfolioId })
      setStressResult(result)
    } catch (error) {
      console.error('Stress test failed:', error)
    } finally {
      setStressTesting(false)
    }
  }, [portfolioId, runStressTestMutation])

  return useMemo(
    () => ({
      dailyReport,
      analyzing,
      analyzeStep,
      stressResult,
      stressTesting,
      dailyExpanded,
      setDailyExpanded,
      runDailyAnalysis,
      runStressTest,
      closeStressResult: () => setStressResult(null),
      newsEvents,
      setTab: (tab) => navigate(`/portfolio/${portfolioId}/${tab}`),
      setExpandedNews,
      expandedNews,
      expandedStock,
      setExpandedStock,
      strategyBrain,
    }),
    [
      analyzeStep,
      analyzing,
      dailyExpanded,
      dailyReport,
      expandedNews,
      expandedStock,
      navigate,
      newsEvents,
      portfolioId,
      runDailyAnalysis,
      runStressTest,
      setExpandedStock,
      strategyBrain,
      stressResult,
      stressTesting,
    ]
  )
}
