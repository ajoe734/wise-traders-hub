/**
 * Reports Hook
 *
 * Manages daily reports, analysis history, and report refresh operations.
 */

import { useState, useCallback, useMemo } from 'react'
import { normalizeDailyReportEntry, normalizeAnalysisHistoryEntries } from '../lib/reportUtils.js'

/**
 * Reports Hook
 *
 * @param {Object} params
 * @param {Array} params.initialAnalysisHistory - Initial analysis history
 * @param {Object} params.initialDailyReport - Initial daily report
 * @returns {Object} Reports state and operations
 */
export const useReports = ({ initialAnalysisHistory = [], initialDailyReport = null } = {}) => {
  const [analysisHistory, setAnalysisHistory] = useState(() =>
    normalizeAnalysisHistoryEntries(initialAnalysisHistory)
  )
  const [dailyReport, setDailyReport] = useState(() =>
    normalizeDailyReportEntry(initialDailyReport)
  )
  const [dailyExpanded, setDailyExpanded] = useState(false)
  const [expandedNews, setExpandedNews] = useState(new Set())
  const [reportRefreshing, setReportRefreshing] = useState(false)
  const [reportRefreshMeta, setReportRefreshMeta] = useState({})

  /**
   * Update analysis history
   */
  const updateAnalysisHistory = useCallback(async (pid, suffix, data) => {
    if (suffix !== 'analysis-history-v1') return
    const normalized = normalizeAnalysisHistoryEntries(data)
    setAnalysisHistory(normalized)
  }, [])

  /**
   * Update daily report
   */
  const updateDailyReport = useCallback(async (pid, suffix, data) => {
    if (suffix !== 'daily-report-v1') return
    const normalized = normalizeDailyReportEntry(data)
    setDailyReport(normalized)
  }, [])

  /**
   * Add analysis to history
   */
  const addAnalysis = useCallback((analysis) => {
    if (!analysis) return

    const normalized = normalizeDailyReportEntry(analysis)
    if (!normalized) return

    setAnalysisHistory((prev) => {
      const next = [normalized, ...prev.filter((a) => a.id !== analysis.id)]
      return normalizeAnalysisHistoryEntries(next)
    })
  }, [])

  /**
   * Delete analysis from history
   */
  const deleteAnalysis = useCallback(
    (reportId) => {
      if (!reportId) return

      setAnalysisHistory((prev) => prev.filter((a) => a.id !== reportId))

      // If deleting the selected daily report, clear it
      if (dailyReport?.id === reportId) {
        setDailyReport(null)
        setDailyExpanded(false)
      }
    },
    [dailyReport]
  )

  /**
   * Toggle news expansion
   */
  const toggleNewsExpansion = useCallback((newsId) => {
    setExpandedNews((prev) => {
      const next = new Set(prev)
      if (next.has(newsId)) {
        next.delete(newsId)
      } else {
        next.add(newsId)
      }
      return next
    })
  }, [])

  /**
   * Clear all expanded news
   */
  const clearExpandedNews = useCallback(() => {
    setExpandedNews(new Set())
  }, [])

  /**
   * Get analysis by date
   */
  const getAnalysisByDate = useCallback(
    (date) => {
      return analysisHistory.find((a) => a.date === date) || null
    },
    [analysisHistory]
  )

  /**
   * Get analysis by ID
   */
  const getAnalysisById = useCallback(
    (id) => {
      return analysisHistory.find((a) => a.id === id) || null
    },
    [analysisHistory]
  )

  /**
   * Latest analysis
   */
  const latestAnalysis = useMemo(() => {
    return analysisHistory[0] || null
  }, [analysisHistory])

  /**
   * Analysis count
   */
  const analysisCount = useMemo(() => {
    return analysisHistory.length
  }, [analysisHistory])

  /**
   * Report refresh queue
   */
  const reportRefreshQueue = useMemo(() => {
    const meta = reportRefreshMeta || {}
    return meta.queue || []
  }, [reportRefreshMeta])

  /**
   * Report refresh limit status
   */
  const reportRefreshLimitStatus = useMemo(() => {
    const meta = reportRefreshMeta || {}
    const todayCount = meta.todayCount || 0
    const dailyLimit = 5
    return {
      used: todayCount,
      remaining: Math.max(0, dailyLimit - todayCount),
      limit: dailyLimit,
      exhausted: todayCount >= dailyLimit,
    }
  }, [reportRefreshMeta])

  return {
    // State
    analysisHistory,
    dailyReport,
    dailyExpanded,
    expandedNews,
    reportRefreshing,
    reportRefreshMeta,

    // Derived
    latestAnalysis,
    analysisCount,
    reportRefreshQueue,
    reportRefreshLimitStatus,

    // Operations
    updateAnalysisHistory,
    updateDailyReport,
    addAnalysis,
    deleteAnalysis,
    toggleNewsExpansion,
    clearExpandedNews,
    getAnalysisByDate,
    getAnalysisById,

    // Setters
    setAnalysisHistory,
    setDailyReport,
    setDailyExpanded,
    setExpandedNews,
    setReportRefreshing,
    setReportRefreshMeta,

    // Helpers
    normalizeDailyReportEntry,
    normalizeAnalysisHistoryEntries,
  }
}
