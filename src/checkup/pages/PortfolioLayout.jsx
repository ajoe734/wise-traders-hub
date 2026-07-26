import { createElement as h } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import Header from '../components/Header.jsx'
import { C } from '../theme.js'
import { useRoutePortfolioRuntime } from '../hooks/useRoutePortfolioRuntime.js'
import {
  ShellEventBusProvider,
  useHoldingsFocusNavigation,
  useClosingOpenStockNavigation,
  useResearchPrefillNavigation,
} from '../shell/ShellEventBusProvider'

function PortfolioLayoutInner() {
  const { portfolioId } = useParams()
  // Shell listeners：跨模組主動跳轉一律走 event bus。
  useHoldingsFocusNavigation(portfolioId)        // M2/M3 → M1
  useClosingOpenStockNavigation(portfolioId)      // M1 → M2
  useResearchPrefillNavigation(portfolioId)       // M2/M3 → M5
  const { headerProps, outletContext } = useRoutePortfolioRuntime()

  return h(
    'div',
    {
      className: 'checkup-root',
      style: {
        background: C.bg,
        minHeight: '100vh',
        color: C.text,
        fontFamily: 'var(--cm-font-sans)',
        paddingBottom: 40,
      },
    },
    h(Header, headerProps),
    h('div', { className: 'cm-shell-inner' }, h(Outlet, { context: outletContext }))
  )
}

export function PortfolioLayout() {
  return h(ShellEventBusProvider, null, h(PortfolioLayoutInner, null))
}
