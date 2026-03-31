import { createElement as h } from 'react'
import { EventsPanel } from '../components/events/index.js'
import { useRouteEventsPage } from '../hooks/useRouteEventsPage.js'

export function EventsPage() {
  const panelProps = useRouteEventsPage()

  return h(EventsPanel, panelProps)
}
