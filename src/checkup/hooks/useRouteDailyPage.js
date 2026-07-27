import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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

  // Phase A2 (holdings-consistency-tdd.md)：Shell Bus §5 closing:openStock deep-link 還原。
  const [searchParams] = useSearchParams()
  const stockParam = searchParams.get('stock')
  useEffect(() => {
    if (stockParam && stockParam !== expandedStock) {
      setExpandedStock(stockParam)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockParam])

  const runDailyAnalysisMutation = useRunDailyAnalysis()
  const runStressTestMutation = useRunStressTest()

  // refs so runDailyAnalysis identity is stable (analysisHistory churns often)
  const setDailyReportRef = useRef(setDailyReport)
  const setAnalysisHistoryRef = useRef(setAnalysisHistory)
  const runDailyAnalysisMutationRef = useRef(runDailyAnalysisMutation)
  useEffect(() => { setDailyReportRef.current = setDailyReport }, [setDailyReport])
  useEffect(() => { setAnalysisHistoryRef.current = setAnalysisHistory }, [setAnalysisHistory])
  useEffect(() => { runDailyAnalysisMutationRef.current = runDailyAnalysisMutation }, [runDailyAnalysisMutation])

  const runDailyAnalysis = useCallback(async () => {
    setAnalyzing(true)
    setAnalyzeStep('正在分析今日收盤數據...')
    try {
      const result = await runDailyAnalysisMutationRef.current.mutateAsync({
        portfolioId,
        data: {},
      })
      setDailyReportRef.current(result)
      setAnalysisHistoryRef.current((prev) =>
        [result, ...(Array.isArray(prev) ? prev : [])].slice(0, 30)
      )
    } catch (error) {
      console.error('Daily analysis failed:', error)
    } finally {
      setAnalyzing(false)
      setAnalyzeStep('')
    }
  }, [portfolioId])

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
