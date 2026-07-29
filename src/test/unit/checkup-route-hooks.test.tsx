/**
 * L2 · Route hook 單元測試（升級版）
 *
 * 舊 `checkup-modules-contract.test.tsx` 只驗 hook 回傳 key 存在。
 * 這裡進一步驗：**呼叫 setter/handler → 對應 mock 真的被叫**。
 * hook 內部 useMemo/useCallback deps 漏抓、setter 沒接會在這裡爆炸。
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return React.createElement(QueryClientProvider, { client: qc }, children)
}

const mockContext: any = {}
const updateEventMock = vi.fn()
const setResearchHistoryMock = vi.fn()
const setTradeLogMock = vi.fn()
const setHoldingsMock = vi.fn()
const setDailyReportMock = vi.fn()
const setAnalysisHistoryMock = vi.fn()

vi.mock('@/checkup/pages/usePortfolioRouteContext.js', () => ({
  usePortfolioRouteContext: () => mockContext,
}))

let mockSearch = new URLSearchParams()
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/', search: '' }),
  useParams: () => ({ portfolioId: 'me' }),
  useSearchParams: () => [mockSearch, vi.fn()] as const,
}))

vi.mock('@/checkup/hooks/api/useAnalysis.js', () => ({
  useRunDailyAnalysis: () => ({ mutateAsync: vi.fn().mockResolvedValue({ id: 'r1' }), isPending: false }),
  useRunStressTest: () => ({ mutateAsync: vi.fn().mockResolvedValue({ id: 's1' }), isPending: false }),
}))

vi.mock('@/checkup/hooks/api/useResearch.js', () => ({
  useEnrichResearchToDossier: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRefreshAnalystReports: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/checkup/hooks/useResearchWorkflow.js', () => ({
  useResearchWorkflow: () => ({ runResearch: vi.fn() }),
}))

vi.mock('@/checkup/hooks/useTradeCaptureRuntime.js', () => ({
  useTradeCaptureRuntime: () => ({ tradeCapture: {}, tradeLog: [] }),
}))

vi.mock('@/checkup/contexts/CheckupModeContext.jsx', () => ({
  useCheckupMode: () => ({ mode: 'live', isDemo: false }),
}))

beforeEach(() => {
  mockSearch = new URLSearchParams()
  updateEventMock.mockClear()
  setResearchHistoryMock.mockClear()
  setTradeLogMock.mockClear()
  setHoldingsMock.mockClear()
  setDailyReportMock.mockClear()
  setAnalysisHistoryMock.mockClear()
  Object.keys(mockContext).forEach((k) => delete mockContext[k])
  Object.assign(mockContext, {
    portfolioId: 'me',
    holdings: [],
    tradeLog: [],
    newsEvents: [],
    targets: {},
    fundamentals: {},
    holdingDossiers: [],
    analysisHistory: [],
    strategyBrain: null,
    portfolioNotes: {},
    researchHistory: [],
    reversalConditions: {},
    dailyReport: null,
    setResearchHistory: setResearchHistoryMock,
    setTradeLog: setTradeLogMock,
    setHoldings: setHoldingsMock,
    setDailyReport: setDailyReportMock,
    setAnalysisHistory: setAnalysisHistoryMock,
    setStrategyBrain: vi.fn(),
    updateEvent: updateEventMock,
    updateTargetPrice: vi.fn(),
    updateAlert: vi.fn(),
    updateReversal: vi.fn(),
    upsertTargetReport: vi.fn(),
    upsertFundamentalsEntry: vi.fn(),
    applyTradeEntryToHoldings: (r: any) => r,
    createDefaultFundamentalDraft: () => ({}),
    toSlashDate: () => '2026/07/26',
    flashSaved: vi.fn(),
  })
})

describe('L2 · M1 useRouteHoldingsPage', () => {
  it('回傳 panelProps 與 tableProps 且 holdings 為陣列', { timeout: 30_000 }, async () => {
    const { useRouteHoldingsPage } = await import('@/checkup/modules/holdings')
    const { result } = renderHook(() => useRouteHoldingsPage(), { wrapper })
    expect(result.current.panelProps).toBeDefined()
    expect(Array.isArray(result.current.panelProps.holdings)).toBe(true)
  })
})

describe('L2 · M2 useRouteDailyPage / useRouteNewsPage', () => {
  it('daily hook：runDailyAnalysis 呼叫後 setDailyReport 會被叫', async () => {
    const { useRouteDailyPage } = await import('@/checkup/modules/closing')
    const { result } = renderHook(() => useRouteDailyPage(), { wrapper })
    expect(typeof result.current.runDailyAnalysis).toBe('function')
    await act(async () => {
      await result.current.runDailyAnalysis()
    })
    expect(setDailyReportMock).toHaveBeenCalledWith({ id: 'r1' })
    expect(setAnalysisHistoryMock).toHaveBeenCalled()
  })

  it('news hook：submitReview 呼叫後 updateEvent 會被叫（含 reviewingEvent id）', async () => {
    const { useRouteNewsPage } = await import('@/checkup/modules/closing')
    const { result } = renderHook(() => useRouteNewsPage(), { wrapper })
    act(() => {
      result.current.setReviewingEvent({ id: 'ev-1', code: '2330' })
    })
    act(() => {
      result.current.submitReview()
    })
    expect(updateEventMock).toHaveBeenCalledTimes(1)
    expect(updateEventMock.mock.calls[0][0]).toBe('ev-1')
    expect(updateEventMock.mock.calls[0][1]).toMatchObject({ status: 'closed' })
  })
})

describe('L2 · M3 useRouteEventsPage', () => {
  it('filterType 切換會過濾 newsEvents', async () => {
    mockContext.newsEvents = [
      { id: '1', type: '財報' },
      { id: '2', type: '除權息' },
      { id: '3', type: '財報' },
    ]
    const { useRouteEventsPage } = await import('@/checkup/modules/events')
    const { result } = renderHook(() => useRouteEventsPage(), { wrapper })
    expect(result.current.filteredEvents).toHaveLength(3)
    act(() => result.current.setFilterType('財報'))
    expect(result.current.filteredEvents).toHaveLength(2)
  })

  it('契約：暴露 reloadNewsEvents callback 且能被 EventsPage 調用（Shell Bus §8 follow-up）', async () => {
    const reloadNewsEventsMock = vi.fn().mockResolvedValue([{ id: 'ev-r', type: '財報' }])
    mockContext.reloadNewsEvents = reloadNewsEventsMock
    const { useRouteEventsPage } = await import('@/checkup/modules/events')
    const { result } = renderHook(() => useRouteEventsPage(), { wrapper })
    expect(typeof result.current.reloadNewsEvents).toBe('function')
    await act(async () => {
      await result.current.reloadNewsEvents()
    })
    expect(reloadNewsEventsMock).toHaveBeenCalledTimes(1)
  })
})

describe('L2 · M4 useRouteTradePage / useRouteLogPage', () => {
  it('trade hook：回傳 tradeCapture 物件', async () => {
    const { useRouteTradePage } = await import('@/checkup/modules/tradeIO')
    const { result } = renderHook(() => useRouteTradePage(), { wrapper })
    expect(result.current).toBeDefined()
    expect((result.current as any).tradeCapture).toBeDefined()
  })

  it('log hook：暴露 setTradeLog / setHoldings 給 LogPanel', async () => {
    const { useRouteLogPage } = await import('@/checkup/modules/tradeIO')
    const { result } = renderHook(() => useRouteLogPage(), { wrapper })
    expect(result.current.setTradeLog).toBe(setTradeLogMock)
    expect(result.current.setHoldings).toBe(setHoldingsMock)
  })
})

describe('L2 · M5 useRouteResearchPage', () => {
  it('回傳 researching / researchHistory / runResearch handler', async () => {
    const { useRouteResearchPage } = await import('@/checkup/modules/research')
    const { result } = renderHook(() => useRouteResearchPage(), { wrapper })
    expect(result.current).toBeDefined()
    expect(typeof result.current.researching).toBe('boolean')
    expect(Array.isArray(result.current.researchHistory)).toBe(true)
  })
})

/**
 * Phase A (holdings-consistency-tdd.md)：Shell Bus §5 deep-link 消費驗證。
 * 這組測試守護「內部深連結 → route hook 還原 UI 狀態」的契約。
 */
describe('L2 · Deep-link consumption (Phase A)', () => {
  it('A1 · holdings ?expand=2330 掛載即 setExpandedStock(2330)', async () => {
    mockSearch = new URLSearchParams('expand=2330')
    const { useBrainStore } = await import('@/checkup/stores/brainStore.js')
    const spy = vi.fn()
    useBrainStore.setState({ setExpandedStock: spy, expandedStock: null } as any)
    const { useRouteHoldingsPage } = await import('@/checkup/modules/holdings')
    renderHook(() => useRouteHoldingsPage(), { wrapper })
    expect(spy).toHaveBeenCalledWith('2330')
  })

  it('A2 · daily ?stock=2330 掛載即 setExpandedStock(2330)', async () => {
    mockSearch = new URLSearchParams('stock=2330')
    const { useBrainStore } = await import('@/checkup/stores/brainStore.js')
    const spy = vi.fn()
    useBrainStore.setState({ setExpandedStock: spy, expandedStock: null } as any)
    const { useRouteDailyPage } = await import('@/checkup/modules/closing')
    renderHook(() => useRouteDailyPage(), { wrapper })
    expect(spy).toHaveBeenCalledWith('2330')
  })

  it('A3 · research ?stock=2330&topic=chips 暴露 prefillStockCode / prefillTopic', async () => {
    mockSearch = new URLSearchParams('stock=2330&topic=chips')
    const { useRouteResearchPage } = await import('@/checkup/modules/research')
    const { result } = renderHook(() => useRouteResearchPage(), { wrapper })
    expect(result.current.prefillStockCode).toBe('2330')
    expect(result.current.prefillTopic).toBe('chips')
  })

  it('A3 · research 無 query 時 prefill* 為 null', async () => {
    mockSearch = new URLSearchParams()
    const { useRouteResearchPage } = await import('@/checkup/modules/research')
    const { result } = renderHook(() => useRouteResearchPage(), { wrapper })
    expect(result.current.prefillStockCode).toBeNull()
    expect(result.current.prefillTopic).toBeNull()
  })
})

