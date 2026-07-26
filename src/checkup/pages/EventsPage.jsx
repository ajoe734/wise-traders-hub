import { createElement as h, useCallback, useState } from 'react'
import { EventsPanel } from '../components/events/index.js'
import { useRouteEventsPage } from '../hooks/useRouteEventsPage.js'
import { useOnEventsRefresh } from '../modules/events/useOnEventsRefresh'
import { useEmitEventsRefresh } from '../modules/tradeIO'
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

  // 測試用 beacon：僅在 `?bus_test=1` 時渲染，讓 E2E 能在 EventsPage 已掛載後
  // emit `events:refresh` 走完 M4→M3 pub/sub 契約。生產介面不受影響。
  const isBusTest = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('bus_test') === '1'
  const emitRefresh = useEmitEventsRefresh()

  return h(
    'div',
    { 'data-events-refresh-tick': refreshTick },
    isBusTest
      ? h(
          'button',
          {
            type: 'button',
            'data-testid': 'events-bus-test-emit-refresh',
            onClick: () => emitRefresh('trade-manual'),
            style: { position: 'fixed', top: 8, right: 8, zIndex: 9999 },
          },
          'Emit events:refresh',
        )
      : null,
    h(EventsPanel, panelProps),
  )
}
