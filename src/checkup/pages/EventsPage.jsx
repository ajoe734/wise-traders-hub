import { createElement as h, useCallback, useState } from 'react'
import { EventsPanel } from '../components/events/index.js'
import { useRouteEventsPage } from '../hooks/useRouteEventsPage.js'
import { useOnEventsRefresh } from '../modules/events/useOnEventsRefresh'
// @analytics-required: shell_bus_events_refresh
import { track } from '@/lib/analytics/events'

export function EventsPage() {
  const panelProps = useRouteEventsPage()
  const [refreshTick, setRefreshTick] = useState(0)

  const handleRefresh = useCallback((payload) => {
    setRefreshTick((n) => n + 1)
    try { track('shell_bus_events_refresh', { source: payload?.source || 'unknown' }) } catch { /* noop */ }
  }, [])

  useOnEventsRefresh(handleRefresh)

  return h('div', { 'data-events-refresh-tick': refreshTick }, h(EventsPanel, panelProps))
}
