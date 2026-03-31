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
        fontFamily: "'Inter','Noto Sans TC',system-ui,sans-serif",
        paddingBottom: 40,
      },
    },
    h(Header, headerProps),
    h('div', { style: { padding: '10px 14px' } }, h(Outlet, { context: outletContext }))
  )
}
