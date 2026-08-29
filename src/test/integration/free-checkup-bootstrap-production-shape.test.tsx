import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useAuthoritativeHoldingsReconciliation,
  useFreeCheckupBootstrap,
} from '@/hooks/useFreeCheckupBootstrap'

const qaCodes = [
  '2330', '2317', '2454', '2382', '2412', '2881', '2882', '2891', '3008', '3034',
  '3711', '2303', '1301', '1303', '1326', '2002', '2207', '2603', '2609', '2615',
  '2884', '2885', '2886', '2887', '2890', '5871', '6505', '6669', '9910', '00637L',
  '2308',
]

const cloud30 = qaCodes.slice(0, 30).map((code, index) => ({
  code,
  name: `名稱${index}`,
  qty: 1,
  cost: 100 + index,
  price: 150 + index,
  priceSource: 'close',
  priceUpdatedAt: '2026-08-29T05:30:00.000Z',
  sector: '既有產業',
  type: '股票',
}))

const memo31 = qaCodes.map((code, index) => ({
  id: `memo-${code}`,
  sort_index: index,
  created_at: '2026-08-29T12:00:00.000Z',
  trade_date: '2026/08/01',
  trade_time: '10:00',
  action: '買進',
  code,
  name: code === '2308' ? '台達電' : `名稱${index}`,
  qty: 1,
  price: 100 + index,
  qa: [],
}))

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve = (_value: T) => {}
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const mocks = vi.hoisted(() => ({
  cloudLoads: [] as Array<Promise<Record<string, unknown>>>,
  memoLoads: [] as Array<Promise<unknown[]>>,
  saved: [] as Array<{ key: string; data: unknown }>,
}))

vi.mock('@/pages/_freeCheckup/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pages/_freeCheckup/constants')>()
  return {
    ...actual,
    loadAllFromCloud: vi.fn(() => mocks.cloudLoads.shift() ?? Promise.resolve({})),
    loadScopedLocal: vi.fn((_key, fallback) => fallback),
    save: vi.fn((key, data) => { mocks.saved.push({ key, data }); return Promise.resolve() }),
    setCurrentUserId: vi.fn(),
    setLocalStorageOwner: vi.fn(),
  }
})

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'qa-user' } } })) },
    from: vi.fn(() => {
      const promise = mocks.memoLoads.shift() ?? Promise.resolve([])
      const query = {
        select: vi.fn(() => query),
        order: vi.fn(() => query),
        then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
          promise.then((data) => resolve({ data, error: null }), reject),
      }
      return query
    }),
  },
}))

function Harness() {
  const [holdings, setHoldings] = useState(cloud30)
  const [tradeLog, setTradeLog] = useState<unknown[]>([])
  const [ready, setReady] = useState(false)
  const resetGuardRef = useRef(0)
  const fetchCalendarEventsRef = useRef(() => {})
  const setters = useMemo(() => ({
    setHoldings,
    setTradeLog,
    setTargets: vi.fn(),
    setNewsEvents: vi.fn(),
    setAnalysisHistory: vi.fn(),
    setReversalConditions: vi.fn(),
    setStrategyBrain: vi.fn(),
    setCalendarEvents: vi.fn(),
    setReady,
    setCloudSync: vi.fn(),
    setDailyReport: vi.fn(),
  }), [])

  useFreeCheckupBootstrap({
    authReady: true,
    isDemo: false,
    setters,
    resetGuardRef,
    fetchCalendarEventsRef,
  })

  return (
    <output data-testid="bootstrap-state">
      {`${holdings.length}|${tradeLog.length}|${ready}|${holdings.some((row) => row.code === '2308')}`}
    </output>
  )
}

function DelayedSlicesHarness({ reverse = false }: { reverse?: boolean }) {
  const [holdings, setHoldings] = useState<typeof cloud30>([])
  const [tradeLog, setTradeLog] = useState<typeof memo31>([])
  const [ready, setReady] = useState(false)

  useAuthoritativeHoldingsReconciliation({ ready, isDemo: false, holdings, tradeLog, setHoldings })

  useEffect(() => {
    const first = window.setTimeout(() => {
      if (reverse) setTradeLog(memo31)
      else setHoldings(cloud30)
      setReady(true)
    }, 1)
    const second = window.setTimeout(() => {
      if (reverse) setHoldings(cloud30)
      else setTradeLog(memo31)
    }, 10)
    return () => { window.clearTimeout(first); window.clearTimeout(second) }
  }, [reverse])

  return <output data-testid="delayed-state">{`${holdings.length}|${tradeLog.length}|${holdings.some((row) => row.code === '2308')}`}</output>
}

async function expectSelfHealed() {
  await waitFor(() => expect(screen.getByTestId('bootstrap-state')).toHaveTextContent('31|31|true|true'))
}

describe('useFreeCheckupBootstrap production-shape self-heal', () => {
  beforeEach(() => {
    mocks.cloudLoads.length = 0
    mocks.memoLoads.length = 0
    mocks.saved.length = 0
    localStorage.clear()
    sessionStorage.clear()
  })

  it('holdings30 先到、memo31 延遲到達後才 ready，並補回 2308', async () => {
    const cloud = deferred<Record<string, unknown>>()
    const memos = deferred<unknown[]>()
    mocks.cloudLoads.push(cloud.promise)
    mocks.memoLoads.push(memos.promise)
    render(<Harness />)

    await act(async () => cloud.resolve({ 'pf-holdings-v2': cloud30 }))
    expect(screen.getByTestId('bootstrap-state')).toHaveTextContent('30|0|false|false')
    await act(async () => memos.resolve(memo31))
    await expectSelfHealed()
  })

  it('memo 已可用、holdings 延遲的 reverse order 最終仍為 31/31', async () => {
    const cloud = deferred<Record<string, unknown>>()
    mocks.cloudLoads.push(cloud.promise)
    mocks.memoLoads.push(Promise.resolve(memo31))
    render(<Harness />)

    await act(async () => cloud.resolve({ 'pf-holdings-v2': cloud30 }))
    await expectSelfHealed()
  })

  it('StrictMode double effect 取消第一輪後，第二輪仍完成自癒', async () => {
    mocks.cloudLoads.push(Promise.resolve({ 'pf-holdings-v2': cloud30 }))
    mocks.cloudLoads.push(Promise.resolve({ 'pf-holdings-v2': cloud30 }))
    mocks.memoLoads.push(Promise.resolve(memo31))
    mocks.memoLoads.push(Promise.resolve(memo31))
    render(<StrictMode><Harness /></StrictMode>)
    await expectSelfHealed()
  })

  it.each([
    ['holdings30 先、logs31 後', false],
    ['logs31 先、holdings30 後', true],
  ])('%s 的獨立 production slices 最終自癒', async (_label, reverse) => {
    render(<DelayedSlicesHarness reverse={reverse} />)
    await waitFor(() => expect(screen.getByTestId('delayed-state')).toHaveTextContent('31|31|true'))
  })

  it('StrictMode 下獨立 slices double effect 最終仍自癒且不重複 2308', async () => {
    render(<StrictMode><DelayedSlicesHarness /></StrictMode>)
    await waitFor(() => expect(screen.getByTestId('delayed-state')).toHaveTextContent('31|31|true'))
  })

  it('重載後以 cloud30 + memo31 再次自癒，不重複 2308', async () => {
    mocks.cloudLoads.push(Promise.resolve({ 'pf-holdings-v2': cloud30 }))
    mocks.memoLoads.push(Promise.resolve(memo31))
    const first = render(<Harness />)
    await expectSelfHealed()
    first.unmount()

    mocks.cloudLoads.push(Promise.resolve({ 'pf-holdings-v2': cloud30 }))
    mocks.memoLoads.push(Promise.resolve(memo31))
    render(<Harness />)
    await expectSelfHealed()
  })
})