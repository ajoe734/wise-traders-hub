import { createElement as h } from 'react'
import { TradePanel } from '../components/trade/index.js'
import { useRouteTradePage } from '../hooks/useRouteTradePage.js'

export function TradePage() {
  const panelProps = useRouteTradePage()

  return h(TradePanel, panelProps)
}
