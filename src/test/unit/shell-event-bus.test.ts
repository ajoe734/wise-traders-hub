/**
 * TDD S1 — Shell Event Bus 契約測試
 *
 * 依 docs/architecture/shell-event-bus-tdd.md §4 S1：
 *   - emit → 所有 on handler 被呼叫，payload 深比對相等
 *   - off 之後不再收事件
 *   - 多次 emit 保序
 *   - handler 拋錯不影響其他 handler
 *
 * 這輪只驗 pub/sub 純函式；React Provider/整合放在 S3。
 */
import { describe, it, expect, vi } from 'vitest'
import { createShellEventBus, type ShellEvents } from '@/checkup/shell/eventBus'

describe('shell/eventBus — pub/sub 契約', () => {
  it('emit 後所有 on handler 被呼叫，payload 深比對相等', () => {
    const bus = createShellEventBus()
    const h1 = vi.fn()
    const h2 = vi.fn()
    bus.on('holdings:focus', h1)
    bus.on('holdings:focus', h2)

    const payload: ShellEvents['holdings:focus'] = { stockCode: '2330', source: 'closing' }
    bus.emit('holdings:focus', payload)

    expect(h1).toHaveBeenCalledTimes(1)
    expect(h2).toHaveBeenCalledTimes(1)
    expect(h1).toHaveBeenCalledWith(payload)
    expect(h2).toHaveBeenCalledWith(payload)
  })

  it('off 之後不再收事件', () => {
    const bus = createShellEventBus()
    const h = vi.fn()
    bus.on('holdings:focus', h)
    bus.off('holdings:focus', h)
    bus.emit('holdings:focus', { stockCode: '2330', source: 'closing' })
    expect(h).not.toHaveBeenCalled()
  })

  it('on 回傳 unsubscribe 函式亦可解除訂閱', () => {
    const bus = createShellEventBus()
    const h = vi.fn()
    const unsub = bus.on('holdings:focus', h)
    unsub()
    bus.emit('holdings:focus', { stockCode: '2454', source: 'events' })
    expect(h).not.toHaveBeenCalled()
  })

  it('多次 emit 依序傳遞給 handler', () => {
    const bus = createShellEventBus()
    const received: string[] = []
    bus.on('holdings:focus', (p) => received.push(p.stockCode))

    bus.emit('holdings:focus', { stockCode: 'A', source: 'closing' })
    bus.emit('holdings:focus', { stockCode: 'B', source: 'events' })
    bus.emit('holdings:focus', { stockCode: 'C', source: 'closing' })

    expect(received).toEqual(['A', 'B', 'C'])
  })

  it('某個 handler 拋錯不影響其他 handler 收到事件', () => {
    const bus = createShellEventBus()
    const boom = vi.fn(() => {
      throw new Error('boom')
    })
    const ok = vi.fn()
    bus.on('holdings:focus', boom)
    bus.on('holdings:focus', ok)

    expect(() =>
      bus.emit('holdings:focus', { stockCode: '2330', source: 'closing' }),
    ).not.toThrow()
    expect(boom).toHaveBeenCalledTimes(1)
    expect(ok).toHaveBeenCalledTimes(1)
  })

  it('同一 handler 重複 on 只註冊一次（Set 去重）', () => {
    const bus = createShellEventBus()
    const h = vi.fn()
    bus.on('holdings:focus', h)
    bus.on('holdings:focus', h)
    bus.emit('holdings:focus', { stockCode: '2330', source: 'closing' })
    expect(h).toHaveBeenCalledTimes(1)
  })

  it('沒有 handler 時 emit 不會拋錯', () => {
    const bus = createShellEventBus()
    expect(() =>
      bus.emit('holdings:focus', { stockCode: '2330', source: 'closing' }),
    ).not.toThrow()
  })
})
