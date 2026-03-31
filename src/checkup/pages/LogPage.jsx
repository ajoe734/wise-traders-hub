import { createElement as h } from 'react'
import { LogPanel } from '../components/log/index.js'
import { useRouteLogPage } from '../hooks/useRouteLogPage.js'

export function LogPage() {
  const panelProps = useRouteLogPage()

  return h(LogPanel, panelProps)
}
