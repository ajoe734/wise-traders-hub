import { createElement as h } from 'react'
import { OverviewPanel } from '../components/overview/index.js'
import { useRouteOverviewPage } from '../hooks/useRouteOverviewPage.js'

export function OverviewPage() {
  const panelProps = useRouteOverviewPage()

  return h(OverviewPanel, panelProps)
}
