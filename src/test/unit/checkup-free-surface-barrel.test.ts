/**
 * S1 · free surface 次級 barrel 煙霧測試（ADR-0005）
 *
 * 只從 `@/checkup/modules/<m>/free` 匯入，確認免費版單頁的對外承諾都活著。
 * barrel 內部路徑打錯、忘記 re-export 會在這裡爆炸。
 */
import { describe, it, expect } from 'vitest'

describe('S1 · free surface barrels', () => {
  it('M1 Holdings free surface', { timeout: 90_000 }, async () => {
    const m = await import('@/checkup/modules/holdings/free')
    for (const k of [
      'HoldingsTab',
      'HoldingCard',
      'HoldingsDetailPanel',
      'HoldingsWorkbench',
      'HoldingsHero',
      'HoldingsSectorSummary',
      'HoldingsFilterBar',
      'HoldingsFooterBar',
      'HoldingsQuotaMeter',
      'HoldingsEmptyState',
      'HoldingsNoMatchState',
      'HoldingsActionPriority',
      'HoldingsReversalSection',
      'HoldingsUploadSummary',
      'HoldingExportCard',
      'HoldingMetaReportModal',
      'ChipsSection',
      'ChipsTrendChart',
      'ActionBadge',
      'PriceTrack',
      'ReturnBar',
      'SectionRule',
      'HoldingCardHeader',
      'HoldingCardFooter',
      'HoldingCardReturn',
      'HoldingCardPriceTrack',
      'HoldingCardSkeleton',
      'RangeBand',
    ]) {
      expect(typeof (m as Record<string, unknown>)[k], k).toMatch(/function|object/)
    }
    expect(typeof m.bsrHeaderLabel).toBe('function')
    expect(typeof m.computeScenario).toBe('function')
    expect(typeof m.getInstReadiness).toBe('function')
  })

  it('M2 Closing free surface', { timeout: 90_000 }, async () => {
    const m = await import('@/checkup/modules/closing/free')
    expect(typeof m.DailyTab).toMatch(/function|object/)
    expect(typeof m.NewsTab).toMatch(/function|object/)
    expect(typeof m.NewsEventRow).toMatch(/function|object/)
  })

  it('M3 Events free surface', { timeout: 90_000 }, async () => {
    const m = await import('@/checkup/modules/events/free')
    expect(typeof m.EventsTab).toMatch(/function|object/)
  })

  it('M4 TradeIO free surface', { timeout: 90_000 }, async () => {
    const m = await import('@/checkup/modules/tradeIO/free')
    for (const k of ['TradeTab', 'LogTab', 'TradeUploadModal', 'BatchParsePanel']) {
      expect(typeof (m as Record<string, unknown>)[k], k).toMatch(/function|object/)
    }
  })

  it('M5 Research free surface', { timeout: 90_000 }, async () => {
    const m = await import('@/checkup/modules/research/free')
    expect(typeof m.ResearchTab).toMatch(/function|object/)
  })

  it('共享層 validateProps 已上升到 lib，freecheckup 內不再持有', async () => {
    const m = await import('@/checkup/lib/validateProps.js')
    expect(typeof m.validateProps).toBe('function')
    expect(typeof m._resetValidationWarnings).toBe('function')
  })
})
