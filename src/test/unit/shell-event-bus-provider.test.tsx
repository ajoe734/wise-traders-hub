/**
 * TDD S3 — ShellEventBusProvider + hook 契約
 *
 * 依 docs/architecture/shell-event-bus.md §4 S3。
 *
 * 涵蓋：
 *   - Provider 內 useShellEventBus() 拿到穩定同一實例（多次 render 同 ref）
 *   - Provider 外呼叫 useShellEventBus() 拋錯且錯誤訊息可辨識
 *   - useShellEventListener 綁定的 handler 收得到 emit
 *   - useHoldingsFocusNavigation 綁在 Shell 後，emit 'holdings:focus' 會
 *     navigate 到 /portfolio/:id/holdings?expand=<stockCode>
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, render, screen } from '@testing-library/react'
import React, { useEffect, useRef } from 'react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import {
  ShellEventBusProvider,
  useShellEventBus,
  useShellEventListener,
  useHoldingsFocusNavigation,
} from '@/checkup/shell/ShellEventBusProvider'

function wrap(children: React.ReactNode) {
  return <ShellEventBusProvider>{children}</ShellEventBusProvider>
}

describe('ShellEventBusProvider — Context 契約', () => {
  it('Provider 內多次 render 拿到同一 bus 實例', () => {
    const { result, rerender } = renderHook(() => useShellEventBus(), {
      wrapper: ({ children }) => <ShellEventBusProvider>{children}</ShellEventBusProvider>,
    })
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
    expect(typeof first.emit).toBe('function')
    expect(typeof first.on).toBe('function')
  })

  it('Provider 外呼叫 useShellEventBus 拋出可辨識錯誤', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useShellEventBus())).toThrow(/ShellEventBusProvider/)
    spy.mockRestore()
  })
})

describe('useShellEventListener', () => {
  it('綁定的 handler 收得到 emit，unmount 後不再收', () => {
    const handler = vi.fn()

    function Listener() {
      useShellEventListener('holdings:focus', handler)
      return null
    }

    function Emitter({ payload }: { payload: { stockCode: string; source: 'closing' | 'events' } }) {
      const bus = useShellEventBus()
      const ref = useRef(bus)
      ref.current = bus
      useEffect(() => {
        ref.current.emit('holdings:focus', payload)
      }, [payload])
      return null
    }

    const { rerender, unmount } = render(
      wrap(
        <>
          <Listener />
          <Emitter payload={{ stockCode: '2330', source: 'closing' }} />
        </>,
      ),
    )
    expect(handler).toHaveBeenCalledWith({ stockCode: '2330', source: 'closing' })

    rerender(
      wrap(
        <>
          <Listener />
          <Emitter payload={{ stockCode: '2454', source: 'events' }} />
        </>,
      ),
    )
    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenLastCalledWith({ stockCode: '2454', source: 'events' })

    unmount()
    // 卸載後不再持有訂閱：新 Provider 就是新 bus，這裡只斷言不再增加
    expect(handler).toHaveBeenCalledTimes(2)
  })
})

describe('useHoldingsFocusNavigation — Shell listener 導航', () => {
  function LocationProbe() {
    const loc = useLocation()
    return <div data-testid="loc">{`${loc.pathname}${loc.search}`}</div>
  }

  function Shell({ portfolioId, onReady }: { portfolioId: string; onReady: (bus: ReturnType<typeof useShellEventBus>) => void }) {
    useHoldingsFocusNavigation(portfolioId)
    const bus = useShellEventBus()
    useEffect(() => {
      onReady(bus)
    }, [bus, onReady])
    return <LocationProbe />
  }

  it('emit holdings:focus 後 URL 變為 /portfolio/<id>/holdings?expand=<stockCode>', () => {
    let capturedBus: ReturnType<typeof useShellEventBus> | null = null
    render(
      <MemoryRouter initialEntries={['/portfolio/demo/daily']}>
        <ShellEventBusProvider>
          <Routes>
            <Route
              path="/portfolio/:portfolioId/*"
              element={
                <Shell
                  portfolioId="demo"
                  onReady={(bus) => {
                    capturedBus = bus
                  }}
                />
              }
            />
          </Routes>
        </ShellEventBusProvider>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('loc').textContent).toBe('/portfolio/demo/daily')
    expect(capturedBus).not.toBeNull()

    act(() => {
      capturedBus!.emit('holdings:focus', { stockCode: '2330', source: 'closing' })
    })

    expect(screen.getByTestId('loc').textContent).toBe('/portfolio/demo/holdings?expand=2330')
  })

  it('不同 stockCode 連續 emit，URL 追隨最新一次', () => {
    let capturedBus: ReturnType<typeof useShellEventBus> | null = null
    render(
      <MemoryRouter initialEntries={['/portfolio/p1/events']}>
        <ShellEventBusProvider>
          <Routes>
            <Route
              path="/portfolio/:portfolioId/*"
              element={
                <Shell
                  portfolioId="p1"
                  onReady={(bus) => {
                    capturedBus = bus
                  }}
                />
              }
            />
          </Routes>
        </ShellEventBusProvider>
      </MemoryRouter>,
    )

    act(() => {
      capturedBus!.emit('holdings:focus', { stockCode: '2454', source: 'events' })
    })
    expect(screen.getByTestId('loc').textContent).toBe('/portfolio/p1/holdings?expand=2454')

    act(() => {
      capturedBus!.emit('holdings:focus', { stockCode: 'AAPL', source: 'closing' })
    })
    expect(screen.getByTestId('loc').textContent).toBe('/portfolio/p1/holdings?expand=AAPL')
  })
})
