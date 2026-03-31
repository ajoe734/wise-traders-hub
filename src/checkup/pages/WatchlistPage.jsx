import { createElement as h } from 'react'
import { WatchlistPanel } from '../components/watchlist/index.js'
import { useRouteWatchlistPage } from '../hooks/useRouteWatchlistPage.js'

export function WatchlistPage() {
  const panelProps = useRouteWatchlistPage()

  return h(WatchlistPanel, panelProps)
}
