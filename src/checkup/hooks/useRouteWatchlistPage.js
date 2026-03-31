import { useMemo } from 'react'
import { useBrainStore } from '../stores/brainStore.js'
import { formatEventStockOutcomeLine } from '../lib/eventUtils.js'
import { buildWatchlistRows } from '../lib/routeRuntime.js'
import { usePortfolioRouteContext } from '../pages/usePortfolioRouteContext.js'

export function useRouteWatchlistPage() {
  const {
    watchlist = [],
    newsEvents = [],
    upsertWatchlist = () => false,
    removeWatchlist = () => {},
  } = usePortfolioRouteContext()

  const expandedStock = useBrainStore((state) => state.expandedStock)
  const setExpandedStock = useBrainStore((state) => state.setExpandedStock)

  return useMemo(() => {
    const watchlistRows = buildWatchlistRows({ watchlist, newsEvents })
    const watchlistFocus =
      watchlistRows.length > 0
        ? [...watchlistRows].sort(
            (a, b) => b.trackingCount + b.pendingCount - (a.trackingCount + a.pendingCount)
          )[0]
        : null

    return {
      watchlistFocus,
      watchlistRows,
      expandedStock,
      setExpandedStock,
      onUpsertItem: upsertWatchlist,
      handleWatchlistDelete: removeWatchlist,
      formatEventStockOutcomeLine,
    }
  }, [expandedStock, newsEvents, removeWatchlist, setExpandedStock, upsertWatchlist, watchlist])
}
