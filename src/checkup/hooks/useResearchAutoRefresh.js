import { useEffect } from 'react'

export function useResearchAutoRefresh({
  ready,
  viewMode,
  portfolioViewMode,
  tab,
  reportRefreshing,
  reportRefreshMeta,
  todayRefreshKey,
  reportRefreshCandidates,
  refreshAnalystReportsRef,
}) {
  useEffect(() => {
    let mounted = true

    const runRefresh = async () => {
      if (!ready || viewMode !== portfolioViewMode || tab !== 'research' || reportRefreshing) return
      if (reportRefreshMeta?.__daily?.date === todayRefreshKey) return
      if (reportRefreshCandidates.length === 0) return

      try {
        await refreshAnalystReportsRef.current({ silent: true })
      } catch (err) {
        if (mounted) console.error('自動刷新公開報告失敗:', err)
      }
    }

    runRefresh()
    return () => {
      mounted = false
    }
  }, [
    ready,
    viewMode,
    portfolioViewMode,
    tab,
    reportRefreshing,
    reportRefreshMeta,
    todayRefreshKey,
    reportRefreshCandidates.length,
    refreshAnalystReportsRef,
  ])
}
