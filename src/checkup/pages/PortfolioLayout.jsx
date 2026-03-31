import { createElement as h } from 'react'
import { Outlet } from 'react-router-dom'
import Header from '../components/Header.jsx'
import { useRoutePortfolioRuntime } from '../hooks/useRoutePortfolioRuntime.js'

export function PortfolioLayout() {
  const { headerProps, outletContext } = useRoutePortfolioRuntime()

  return h(
    'div',
    { style: { minHeight: '100vh' } },
    h(Header, headerProps),
    h('div', { style: { padding: '10px 14px' } }, h(Outlet, { context: outletContext }))
  )
}
