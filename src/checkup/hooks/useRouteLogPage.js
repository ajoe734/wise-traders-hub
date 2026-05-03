import { useMemo } from 'react'
import { usePortfolioRouteContext } from '../pages/usePortfolioRouteContext.js'

export function useRouteLogPage() {
  const ctx = usePortfolioRouteContext()
  const { tradeLog = [], setTradeLog, setHoldings, flashSaved } = ctx || {}

  return useMemo(
    () => ({ tradeLog, setTradeLog, setHoldings, flashSaved }),
    [tradeLog, setTradeLog, setHoldings, flashSaved]
  )
}
