import { useMemo } from 'react'
import { useBrainStore } from '../stores/brainStore.js'
import { usePortfolioRouteContext } from '../pages/usePortfolioRouteContext.js'
import { holdingsValueKeyFull } from '../lib/holdingsSort'

const EMPTY_HOLDINGS = Object.freeze([])

export function useRouteHoldingsPage() {
  const {
    holdings: holdingsRaw = EMPTY_HOLDINGS,
    reversalConditions = {},
    updateTargetPrice = () => {},
    updateAlert = () => {},
    updateReversal = () => {},
  } = usePortfolioRouteContext()

  const expandedStock = useBrainStore((state) => state.expandedStock)
  const setExpandedStock = useBrainStore((state) => state.setExpandedStock)

  // D-Perf-R6 (holdings audit 2026-05 第二輪)：對齊 FreeCheckup B-P2，
  // store push 雖然每次 spread 新陣列，但若值未變則 valueKey 不變 → 同一 reference。
  // 下游 winners/losers/integrityIssues/total* 等 derived 全部命中快取。
  // G-Coverage: 抽到 lib/holdingsSort
  const holdingsValueKey = useMemo(() => holdingsValueKeyFull(holdingsRaw), [holdingsRaw])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const holdings = useMemo(() => holdingsRaw || EMPTY_HOLDINGS, [holdingsValueKey])

  return useMemo(() => {
    const totalVal = holdings.reduce((sum, item) => sum + (item.value || 0), 0)
    const totalCost = holdings.reduce(
      (sum, item) => sum + (Number(item.cost) || 0) * (Number(item.qty) || 0),
      0
    )
    const winners = [...holdings]
      .filter((item) => (item.pct || 0) > 0)
      .sort((a, b) => (b.pct || 0) - (a.pct || 0))
    const losers = [...holdings]
      .filter((item) => (item.pct || 0) < 0)
      .sort((a, b) => (a.pct || 0) - (b.pct || 0))
    const holdingsIntegrityIssues = holdings.filter(
      (item) => item.integrityIssue === 'missing-price'
    )

    return {
      panelProps: {
        holdings,
        totalVal,
        totalCost,
        winners,
        losers,
        holdingsIntegrityIssues,
        showReversal: false,
        setShowReversal: () => {},
        reversalConditions,
        updateReversal,
      },
      tableProps: {
        holdings,
        expandedStock,
        setExpandedStock,
        onUpdateTarget: updateTargetPrice,
        onUpdateAlert: updateAlert,
      },
    }
  }, [
    expandedStock,
    holdings,
    reversalConditions,
    setExpandedStock,
    updateAlert,
    updateReversal,
    updateTargetPrice,
  ])
}
