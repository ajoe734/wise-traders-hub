/**
 * S8 · 事件擴充：closing:openStock / research:prefill / events:refresh
 * 契約：docs/architecture/shell-event-bus-tdd.md §2、§8 步驟 1
 *
 * 涵蓋：
 *   - eventBus 三個新事件的 emit / on 契約
 *   - Shell 導航：closing:openStock → /portfolio/:id/daily?stock=&date=
 *   - Shell 導航：research:prefill → /portfolio/:id/research?stock=&topic=
 *   - events:refresh 為模組間 pub/sub，透過 useOnEventsRefresh 收
 *   - barrel emit helper 皆送出正確 source / optional 欄位
 */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderHook, act, render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import {
  ShellEventBusProvider,
  useShellEventBus,
  useClosingOpenStockNavigation,
  useResearchPrefillNavigation,
} from '@/checkup/shell/ShellEventBusProvider'
import { createShellEventBus } from '@/checkup/shell/eventBus'

// ---- pure bus 契約 ---------------------------------------------------------

describe('eventBus — 新事件契約', () => {
  it('closing:openStock emit → handler 收到含 date 的 payload', () => {
    const bus = createShellEventBus()
    const h = vi.fn()
    bus.on('closing:openStock', h)
    bus.emit('closing:openStock', { stockCode: '2330', date: '2026-07-25', source: 'holdings' })
    expect(h).toHaveBeenCalledWith({ stockCode: '2330', date: '2026-07-25', source: 'holdings' })
  })

  it('research:prefill emit — topic 可省略', () => {
    const bus = createShellEventBus()
    const h = vi.fn()
    bus.on('research:prefill', h)
    bus.emit('research:prefill', { stockCode: '2454', source: 'events' })
    expect(h).toHaveBeenCalledWith({ stockCode: '2454', source: 'events' })
  })

  it('events:refresh 保序 & 多訂閱者', () => {
    const bus = createShellEventBus()
    const received: string[] = []
    bus.on('events:refresh', (p) => received.push(`a:${p.reason}`))
    bus.on('events:refresh', (p) => received.push(`b:${p.reason}`))
    bus.emit('events:refresh', { reason: 'trade-import', source: 'tradeIO' })
    bus.emit('events:refresh', { reason: 'ocr', source: 'tradeIO' })
    expect(received).toEqual([
      'a:trade-import',
      'b:trade-import',
      'a:ocr',
      'b:ocr',
    ])
  })
})

// ---- Shell navigation ------------------------------------------------------

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc">{`${loc.pathname}${loc.search}`}</div>
}

describe('useClosingOpenStockNavigation', () => {
  function Shell({ onReady }: { onReady: (b: ReturnType<typeof useShellEventBus>) => void }) {
    useClosingOpenStockNavigation('demo')
    const bus = useShellEventBus()
    React.useEffect(() => onReady(bus), [bus, onReady])
    return <LocationProbe />
  }

  it('emit closing:openStock → /portfolio/demo/daily?stock=2330&date=2026-07-25', () => {
    let bus: ReturnType<typeof useShellEventBus> | null = null
    render(
      <MemoryRouter initialEntries={['/portfolio/demo/holdings']}>
        <ShellEventBusProvider>
          <Routes>
            <Route
              path="/portfolio/:portfolioId/*"
              element={<Shell onReady={(b) => { bus = b }} />}
            />
          </Routes>
        </ShellEventBusProvider>
      </MemoryRouter>,
    )
    act(() => {
      bus!.emit('closing:openStock', { stockCode: '2330', date: '2026-07-25', source: 'holdings' })
    })
    expect(screen.getByTestId('loc').textContent).toBe(
      '/portfolio/demo/daily?stock=2330&date=2026-07-25',
    )
  })

  it('date 省略時 URL 不帶 date param', () => {
    let bus: ReturnType<typeof useShellEventBus> | null = null
    render(
      <MemoryRouter initialEntries={['/portfolio/demo/holdings']}>
        <ShellEventBusProvider>
          <Routes>
            <Route
              path="/portfolio/:portfolioId/*"
              element={<Shell onReady={(b) => { bus = b }} />}
            />
          </Routes>
        </ShellEventBusProvider>
      </MemoryRouter>,
    )
    act(() => {
      bus!.emit('closing:openStock', { stockCode: 'AAPL', source: 'holdings' })
    })
    expect(screen.getByTestId('loc').textContent).toBe('/portfolio/demo/daily?stock=AAPL')
  })
})

describe('useResearchPrefillNavigation', () => {
  function Shell({ onReady }: { onReady: (b: ReturnType<typeof useShellEventBus>) => void }) {
    useResearchPrefillNavigation('p1')
    const bus = useShellEventBus()
    React.useEffect(() => onReady(bus), [bus, onReady])
    return <LocationProbe />
  }

  it('emit research:prefill → /portfolio/p1/research?stock=&topic=', () => {
    let bus: ReturnType<typeof useShellEventBus> | null = null
    render(
      <MemoryRouter initialEntries={['/portfolio/p1/daily']}>
        <ShellEventBusProvider>
          <Routes>
            <Route
              path="/portfolio/:portfolioId/*"
              element={<Shell onReady={(b) => { bus = b }} />}
            />
          </Routes>
        </ShellEventBusProvider>
      </MemoryRouter>,
    )
    act(() => {
      bus!.emit('research:prefill', { stockCode: '2454', topic: 'AI supply chain', source: 'closing' })
    })
    // URLSearchParams 會把空白編成 '+'
    expect(screen.getByTestId('loc').textContent).toBe(
      '/portfolio/p1/research?stock=2454&topic=AI+supply+chain',
    )
  })
})

// ---- barrel emit / subscribe helpers --------------------------------------

describe('barrel emit/subscribe helpers', () => {
  const wrapperWith = (bus: ReturnType<typeof createShellEventBus>) =>
    ({ children }: { children: React.ReactNode }) =>
      React.createElement(ShellEventBusProvider, { bus, children })

  it('holdings.useEmitClosingOpenStock 送出 source=holdings 與 optional date', async () => {
    const { useEmitClosingOpenStock } = await import('@/checkup/modules/holdings')
    const bus = createShellEventBus()
    const h = vi.fn()
    bus.on('closing:openStock', h)
    const { result } = renderHook(() => useEmitClosingOpenStock(), { wrapper: wrapperWith(bus) })
    act(() => result.current('2330', '2026-07-25'))
    act(() => result.current('AAPL'))
    expect(h.mock.calls[0][0]).toEqual({ stockCode: '2330', date: '2026-07-25', source: 'holdings' })
    expect(h.mock.calls[1][0]).toEqual({ stockCode: 'AAPL', date: undefined, source: 'holdings' })
  })

  it('closing.useEmitResearchPrefill 送出 source=closing', async () => {
    const { useEmitResearchPrefill } = await import('@/checkup/modules/closing')
    const bus = createShellEventBus()
    const h = vi.fn()
    bus.on('research:prefill', h)
    const { result } = renderHook(() => useEmitResearchPrefill(), { wrapper: wrapperWith(bus) })
    act(() => result.current('2330', 'AI'))
    expect(h).toHaveBeenCalledWith({ stockCode: '2330', topic: 'AI', source: 'closing' })
  })

  it('events.useEmitResearchPrefill 送出 source=events', async () => {
    const { useEmitResearchPrefill } = await import('@/checkup/modules/events')
    const bus = createShellEventBus()
    const h = vi.fn()
    bus.on('research:prefill', h)
    const { result } = renderHook(() => useEmitResearchPrefill(), { wrapper: wrapperWith(bus) })
    act(() => result.current('2454'))
    expect(h).toHaveBeenCalledWith({ stockCode: '2454', topic: undefined, source: 'events' })
  })

  it('tradeIO.useEmitEventsRefresh 送出 source=tradeIO', async () => {
    const { useEmitEventsRefresh } = await import('@/checkup/modules/tradeIO')
    const bus = createShellEventBus()
    const h = vi.fn()
    bus.on('events:refresh', h)
    const { result } = renderHook(() => useEmitEventsRefresh(), { wrapper: wrapperWith(bus) })
    act(() => result.current('trade-import'))
    expect(h).toHaveBeenCalledWith({ reason: 'trade-import', source: 'tradeIO' })
  })

  it('events.useOnEventsRefresh 收到 tradeIO emit', async () => {
    const { useEmitEventsRefresh } = await import('@/checkup/modules/tradeIO')
    const { useOnEventsRefresh } = await import('@/checkup/modules/events')
    const bus = createShellEventBus()
    const seen = vi.fn()

    function App() {
      useOnEventsRefresh(seen)
      const emit = useEmitEventsRefresh()
      React.useEffect(() => {
        emit('ocr')
      }, [emit])
      return null
    }

    render(
      <ShellEventBusProvider bus={bus}>
        <App />
      </ShellEventBusProvider>,
    )
    expect(seen).toHaveBeenCalledWith({ reason: 'ocr', source: 'tradeIO' })
  })
})
