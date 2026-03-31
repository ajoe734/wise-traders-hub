import { createElement as h } from 'react'
import { HoldingsPanel, HoldingsTable } from '../components/holdings/index.js'
import { useRouteHoldingsPage } from '../hooks/useRouteHoldingsPage.js'

export function HoldingsPage() {
  const { panelProps, tableProps } = useRouteHoldingsPage()

  return h(HoldingsPanel, panelProps, h(HoldingsTable, tableProps))
}
