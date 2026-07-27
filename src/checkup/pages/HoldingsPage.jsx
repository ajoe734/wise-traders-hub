import { createElement as h, Suspense } from 'react'
import { HoldingsPanel, HoldingsTable } from '../components/holdings/index.js'
import { useRouteHoldingsPage } from '../hooks/useRouteHoldingsPage.js'
import { ErrorBoundary } from '../components/ErrorBoundary.jsx'
import { CheckupSkeleton } from '../components/common/CheckupSkeleton'

// H10 (audit 2026-06) / Phase B2 (holdings-consistency-tdd.md)：
//   render 期錯誤由 ErrorBoundary 接住，async 失敗統一在 App 層的 unhandledrejection 上報。
//   Suspense fallback 改用 CheckupSkeleton，跟 HoldingCard shimmer 視覺一致。
function HoldingsFallback() {
  return h('div', { style: { padding: 16 } }, h(CheckupSkeleton, { variant: 'page', label: '持倉載入中' }))
}

function HoldingsPageInner() {
  const { panelProps, tableProps } = useRouteHoldingsPage()
  return h(HoldingsPanel, panelProps, h(HoldingsTable, tableProps))
}

export function HoldingsPage() {
  return h(
    ErrorBoundary,
    { scope: 'HoldingsPage', title: '持倉' },
    h(Suspense, { fallback: h(HoldingsFallback) }, h(HoldingsPageInner))
  )
}
