import { useMemo } from 'react'
import { useBrainStore } from '../stores/brainStore.js'
import { usePortfolioRouteContext } from '../pages/usePortfolioRouteContext.js'

export function useRouteHoldingsPage() {
  const {
    holdings = [],
    reversalConditions = {},
    updateTargetPrice = () => {},
    updateAlert = () => {},
    updateReversal = () => {},
  } = usePortfolioRouteContext()

  const expandedStock = useBrainStore((state) => state.expandedStock)
  const setExpandedStock = useBrainStore((state) => state.setExpandedStock)

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
