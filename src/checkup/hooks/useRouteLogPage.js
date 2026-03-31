import { useMemo } from 'react'
import { usePortfolioRouteContext } from '../pages/usePortfolioRouteContext.js'

export function useRouteLogPage() {
  const { tradeLog = [] } = usePortfolioRouteContext()

  return useMemo(() => ({ tradeLog }), [tradeLog])
}
