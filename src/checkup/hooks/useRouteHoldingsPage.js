import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
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

  // Phase A1 (holdings-consistency-tdd.md)：Shell Bus §5 deep-link 消費。
  // 進入 /portfolio/:id/holdings?expand=2330 時，還原展開狀態。
  const [searchParams] = useSearchParams()
  const expandParam = searchParams.get('expand')
  useEffect(() => {
    if (expandParam && expandParam !== expandedStock) {
      setExpandedStock(expandParam)
    }
  }, [expandParam, expandedStock, setExpandedStock])



  // D-Perf-R6 / H11 (audit 2026-06)：
  //   store 每次 push 都會 spread 新陣列，holdingsRaw reference 每 tick 都變。
  //   但若各欄位值未變，valueKey 不變 → 下游 derived 應命中快取。
  //   為了讓 useMemo deps 只看 valueKey 又不違反 exhaustive-deps，
  //   用 ref 暫存最新 raw，於 memo body 讀取，避免 eslint-disable。
  const holdingsValueKey = useMemo(() => holdingsValueKeyFull(holdingsRaw), [holdingsRaw])
  const holdingsRawRef = useRef(holdingsRaw)
  holdingsRawRef.current = holdingsRaw
  const holdings = useMemo(
    () => holdingsRawRef.current || EMPTY_HOLDINGS,
    [holdingsValueKey]
  )

  return useMemo(() => {
    // C6 (audit 2026-06)：缺價（integrityIssue==='missing-price'）的持倉，value=0 但 cost*qty 仍會被算進總成本，
    // 造成總報酬率系統性偏低。聚合總值/總成本/勝負時排除這些缺價標的，
    // 改由 holdingsIntegrityIssues 獨立呈現，讓使用者知道有幾檔待補價。
    const validHoldings = holdings.filter((item) => item.integrityIssue !== 'missing-price')
    const totalVal = validHoldings.reduce((sum, item) => sum + (item.value || 0), 0)
    const totalCost = validHoldings.reduce(
      (sum, item) => sum + (Number(item.cost) || 0) * (Number(item.qty) || 0),
      0
    )
    const winners = [...validHoldings]
      .filter((item) => (item.pct || 0) > 0)
      .sort((a, b) => (b.pct || 0) - (a.pct || 0))
    const losers = [...validHoldings]
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
