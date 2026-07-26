import { createElement as h } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import Header from '../components/Header.jsx'
import { C } from '../theme.js'
import { useRoutePortfolioRuntime } from '../hooks/useRoutePortfolioRuntime.js'
import {
  ShellEventBusProvider,
  useHoldingsFocusNavigation,
} from '../shell/ShellEventBusProvider'

function PortfolioLayoutInner() {
  const { portfolioId } = useParams()
  // Shell listener：M2/M3 emit('holdings:focus') → navigate 到 M1 並展開股票。
  useHoldingsFocusNavigation(portfolioId)
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
