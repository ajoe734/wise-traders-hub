/**
 * L1 · 深模組 Barrel 煙霧測試
 *
 * 只從 `@/checkup/modules/<name>` 匯入，驗每個 barrel 的對外承諾都活著：
 *   - 對外 hook / Page / Panel 都是可呼叫函式（React 元件或 hook）。
 *   - barrel 內部路徑打錯、忘記 re-export 會在這裡爆炸。
 *
 * 抓過的低垂果實：TradeIO barrel 曾漏 export TradePanel（2026-07-26 已補）。
 */
import { describe, it, expect } from 'vitest'

describe('L1 · module barrels re-export contract', () => {
  it('M1 Holdings barrel 對外符號齊全', async () => {
    const mod = await import('@/checkup/modules/holdings')
    expect(typeof mod.useRouteHoldingsPage).toBe('function')
    expect(typeof mod.HoldingsPage).toBe('function')
    expect(typeof mod.HoldingsPanel).toBe('function')
    expect(typeof mod.HoldingsTable).toBe('function')
  })

  it('M2 Closing barrel 對外符號齊全', async () => {
    const mod = await import('@/checkup/modules/closing')
    expect(typeof mod.useRouteDailyPage).toBe('function')
    expect(typeof mod.useRouteNewsPage).toBe('function')
    expect(typeof mod.DailyPage).toBe('function')
    expect(typeof mod.NewsPage).toBe('function')
    expect(typeof mod.DailyReportPanel).toBe('function')
    expect(typeof mod.NewsAnalysisPanel).toBe('function')
  })

  it('M3 Events barrel 對外符號齊全', async () => {
    const mod = await import('@/checkup/modules/events')
    expect(typeof mod.useRouteEventsPage).toBe('function')
    expect(typeof mod.EventsPage).toBe('function')
    expect(typeof mod.EventsPanel).toBe('function')
    expect(typeof mod.EventCard).toBe('function')
    expect(typeof mod.RelayPlanCard).toBe('function')
    expect(typeof mod.EventsFilter).toBe('function')
  })

  it('M4 TradeIO barrel 對外符號齊全（含 TradePanel）', async () => {
    const mod = await import('@/checkup/modules/tradeIO')
    expect(typeof mod.useRouteTradePage).toBe('function')
    expect(typeof mod.useRouteLogPage).toBe('function')
    expect(typeof mod.TradePage).toBe('function')
    expect(typeof mod.LogPage).toBe('function')
    // regression guard: TradePanel 曾漏 export
    expect(typeof mod.TradePanel).toBe('function')
    expect(typeof mod.LogPanel).toBe('function')
  })

  it('M5 Research barrel 對外符號齊全', async () => {
    const mod = await import('@/checkup/modules/research')
    expect(typeof mod.useRouteResearchPage).toBe('function')
    expect(typeof mod.ResearchPage).toBe('function')
    expect(typeof mod.ResearchPanel).toBe('function')
  })
})
