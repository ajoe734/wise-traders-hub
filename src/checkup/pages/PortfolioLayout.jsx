import { createElement as h } from 'react'
import { Outlet } from 'react-router-dom'
import Header from '../components/Header.jsx'
import { C } from '../theme.js'
import { useRoutePortfolioRuntime } from '../hooks/useRoutePortfolioRuntime.js'

export function PortfolioLayout() {
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
