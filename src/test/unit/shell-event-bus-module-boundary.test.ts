/**
 * S4 · M2/M3 barrel emit helper + 邊界靜態掃描
 * 契約：docs/architecture/shell-event-bus-tdd.md §4 S4
 *
 * 規則：
 *   - M2 (closing) / M3 (events) 模組內任何檔案不得深 import M1 (holdings)。
 *   - 兩個模組的 barrel 必須 export `useEmitHoldingsFocus`。
 *   - emit helper 呼叫時真的會發 `holdings:focus`，且 source 正確。
 */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderHook, act } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MODULES_DIR = join(process.cwd(), 'src/checkup/modules')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(p)
  }
  return out
}

describe('S4 · barrel emit helper + 邊界靜態掃描', () => {
  for (const mod of ['closing', 'events'] as const) {
    it(`M2/M3 "${mod}" 內任何檔案不得深 import ../holdings 或 components/holdings`, () => {
      const files = walk(join(MODULES_DIR, mod))
      for (const f of files) {
        const src = readFileSync(f, 'utf-8')
        expect(
          /from ['"]\.\.\/holdings(\/|['"])/.test(src),
          `${f} 不得 import ../holdings`,
        ).toBe(false)
        expect(
          /from ['"][^'"]*components\/holdings/.test(src),
          `${f} 不得 import components/holdings`,
        ).toBe(false)
      }
    })
  }

  it('closing barrel export useEmitHoldingsFocus', async () => {
    const mod = await import('@/checkup/modules/closing')
    expect(typeof mod.useEmitHoldingsFocus).toBe('function')
  })

  it('events barrel export useEmitHoldingsFocus', async () => {
    const mod = await import('@/checkup/modules/events')
    expect(typeof mod.useEmitHoldingsFocus).toBe('function')
  })

  it('closing.useEmitHoldingsFocus emit holdings:focus with source=closing', async () => {
    const { createShellEventBus } = await import('@/checkup/shell/eventBus')
    const { ShellEventBusProvider } = await import('@/checkup/shell/ShellEventBusProvider')
    const { useEmitHoldingsFocus } = await import('@/checkup/modules/closing')
    const bus = createShellEventBus()
    const handler = vi.fn()
    bus.on('holdings:focus', handler)
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ShellEventBusProvider, { bus, children })
    const { result } = renderHook(() => useEmitHoldingsFocus(), { wrapper })
    act(() => result.current('2330'))
    expect(handler).toHaveBeenCalledWith({ stockCode: '2330', source: 'closing' })
  })

  it('events.useEmitHoldingsFocus emit holdings:focus with source=events', async () => {
    const { createShellEventBus } = await import('@/checkup/shell/eventBus')
    const { ShellEventBusProvider } = await import('@/checkup/shell/ShellEventBusProvider')
    const { useEmitHoldingsFocus } = await import('@/checkup/modules/events')
    const bus = createShellEventBus()
    const handler = vi.fn()
    bus.on('holdings:focus', handler)
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ShellEventBusProvider, { bus, children })
    const { result } = renderHook(() => useEmitHoldingsFocus(), { wrapper })
    act(() => result.current('AAPL'))
    expect(handler).toHaveBeenCalledWith({ stockCode: 'AAPL', source: 'events' })
  })
})
