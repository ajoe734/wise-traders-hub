import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ACTIVE_PORTFOLIO_KEY, OWNER_PORTFOLIO_ID, buildPortfolioRoute } from '../constants.js'
import {
  buildOverviewRuntimeData,
  readRouteMarketState,
  readRuntimePortfolios,
} from '../lib/routeRuntime.js'
import { readStorageValue } from '../lib/portfolioUtils.js'

export function useRouteOverviewPage() {
  const navigate = useNavigate()

  return useMemo(() => {
    const portfolios = readRuntimePortfolios()
    const { marketPriceCache } = readRouteMarketState()
    const {
      overviewPortfolios,
      overviewTotalValue,
      overviewTotalPnl,
      overviewDuplicateHoldings,
      overviewPendingItems,
    } = buildOverviewRuntimeData({ portfolios, marketPriceCache })

    const activePortfolioId = readStorageValue(ACTIVE_PORTFOLIO_KEY) || OWNER_PORTFOLIO_ID

    return {
      portfolioCount: overviewPortfolios.length,
      totalValue: overviewTotalValue,
      totalPnl: overviewTotalPnl,
      portfolios: overviewPortfolios,
      activePortfolioId,
      duplicateHoldings: overviewDuplicateHoldings,
      pendingItems: overviewPendingItems,
      onExit: () => navigate(buildPortfolioRoute(activePortfolioId)),
      onSwitch: (portfolioId) => navigate(buildPortfolioRoute(portfolioId)),
    }
  }, [navigate])
}
