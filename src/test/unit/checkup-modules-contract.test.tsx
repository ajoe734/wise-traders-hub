/**
 * 深模組契約測試 — 鎖住 M2 / M3 / M4 / M5 route hook 對外形狀。
 * M1 (useRouteHoldingsPage) 已由 holdings-page.test.tsx 覆蓋。
 * 詳見 docs/architecture/holdings-modules.md。
 */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client: qc }, children)


vi.mock('@/checkup/pages/usePortfolioRouteContext.js', () => ({
  usePortfolioRouteContext: () => ({
    holdings: [],
    newsEvents: [],
    tradeLog: [],
    reviewingEvent: null,
    reviewForm: null,
    expandedNews: null,
    filteredEvents: [],
    catalystFilter: '全部',
    filterType: '全部',
    dailyReport: null,
    morningNote: '',
    strategyBrain: null,
    researchResults: null,
    researchHistory: [],
    researchTarget: null,
    researching: false,
    analyzing: false,
    analyzeStep: 0,
    stressResult: null,
    stressTesting: false,
    reportRefreshing: false,
    reportRefreshStatus: null,
    dataRefreshRows: [],
    enrichingResearchCode: null,
    STOCK_META: {},
    IND_COLOR: {},
    setReviewForm: vi.fn(),
    submitReview: vi.fn(),
    cancelReview: vi.fn(),
    setExpandedNews: vi.fn(),
    setTab: vi.fn(),
    setReviewingEvent: vi.fn(),
    setFilterType: vi.fn(),
    setCatalystFilter: vi.fn(),
    setDailyExpanded: vi.fn(),
    runDailyAnalysis: vi.fn(),
    runDailyAnalysisInBackground: vi.fn(),
    runStressTest: vi.fn(),
    setStressResult: vi.fn(),
    refreshAnalystReports: vi.fn(),
    runResearch: vi.fn(),
    enrichResearchToDossier: vi.fn(),
    setResearchResults: vi.fn(),
  }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@/checkup/hooks/api/useAnalysis.js', () => ({
  useRunDailyAnalysis: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRunStressTest: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/checkup/hooks/useTradeCaptureRuntime.js', () => ({
  useTradeCaptureRuntime: () => ({ tradeCapture: {} }),
}))

vi.mock('@/checkup/contexts/CheckupModeContext.jsx', () => ({
  useCheckupMode: () => ({ mode: 'live' }),
}))

const brainState = {
  expandedStock: null,
  setExpandedStock: vi.fn(),
  relayPlanExpanded: false,
  setRelayPlanExpanded: vi.fn(),
  dailyExpanded: false,
  strategyBrain: null,
}
vi.mock('@/checkup/stores/brainStore.js', () => ({
  useBrainStore: (selector: any) => (typeof selector === 'function' ? selector(brainState) : brainState),
}))

import { useRouteDailyPage } from '@/checkup/hooks/useRouteDailyPage.js'
import { useRouteEventsPage } from '@/checkup/hooks/useRouteEventsPage.js'
import { useRouteNewsPage } from '@/checkup/hooks/useRouteNewsPage.js'
import { useRouteLogPage } from '@/checkup/hooks/useRouteLogPage.js'
import { useRouteTradePage } from '@/checkup/hooks/useRouteTradePage.js'
import { useRouteResearchPage } from '@/checkup/hooks/useRouteResearchPage.js'

describe('深模組 route hook 契約', () => {
  it('M2 useRouteDailyPage 回傳物件（daily panel props）', () => {
    const { result } = renderHook(() => useRouteDailyPage(), { wrapper })
    expect(result.current).toBeTypeOf('object')
    expect(result.current).not.toBeNull()
  })

  it('M2 useRouteNewsPage 回傳物件（news panel props）', () => {
    const { result } = renderHook(() => useRouteNewsPage(), { wrapper })
    expect(result.current).toBeTypeOf('object')
    expect(result.current).not.toBeNull()
  })

  it('M3 useRouteEventsPage 回傳物件（events panel props）', () => {
    const { result } = renderHook(() => useRouteEventsPage(), { wrapper })
    expect(result.current).toBeTypeOf('object')
    expect(result.current).not.toBeNull()
  })

  it('M4 useRouteLogPage 回傳物件（log panel props）', () => {
    const { result } = renderHook(() => useRouteLogPage(), { wrapper })
    expect(result.current).toBeTypeOf('object')
    expect(result.current).not.toBeNull()
  })

  it('M4 useRouteTradePage 回傳物件（trade panel props）', () => {
    const { result } = renderHook(() => useRouteTradePage(), { wrapper })
    expect(result.current).toBeTypeOf('object')
    expect(result.current).not.toBeNull()
  })

  it('M5 useRouteResearchPage 回傳物件（research panel props）', () => {
    const { result } = renderHook(() => useRouteResearchPage(), { wrapper })
    expect(result.current).toBeTypeOf('object')
    expect(result.current).not.toBeNull()
  })
})
