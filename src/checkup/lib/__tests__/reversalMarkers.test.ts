import { describe, it, expect } from 'vitest';
import {
  buildReversalMarkers,
  reversalConfirmText,
  reversalTooltipByDate,
  REVERSAL_GLYPH,
} from '@/checkup/lib/reversalMarkers';
import type { ReversalSignal } from '@/checkup/lib/reversalSignals';

const sig = (over: Partial<ReversalSignal>): ReversalSignal => ({
  kind: 'hammer',
  direction: 'bullish',
  state: 'pending',
  signalDate: '2026-07-20',
  triggerPrice: 118,
  reasons: [],
  index: 10,
  relVolume: 1.5,
  resolvedDate: null,
  ageBars: 1,
  confirmedAgeBars: 0,
  ...over,
});

const bars = Array.from({ length: 5 }, (_, i) => ({
  date: `2026-07-2${i}`,
  open: 100 + i, high: 110 + i, low: 90 + i, close: 105 + i, volume: 1000,
})) as any[];

describe('buildReversalMarkers', () => {
  it('多方標在棒下、空方標在棒上，並錨定 low / high', () => {
    const ms = buildReversalMarkers(
      [sig({ signalDate: '2026-07-21' }), sig({ signalDate: '2026-07-23', kind: 'shooting_star', direction: 'bearish', triggerPrice: 113 })],
      bars,
    );
    expect(ms).toHaveLength(2);
    expect(ms[0]).toMatchObject({ index: 1, placement: 'below', anchorPrice: 91 });
    expect(ms[1]).toMatchObject({ index: 3, placement: 'above', anchorPrice: 113 });
  });

  it('三種狀態用不同字形區分，不靠顏色', () => {
    const [p] = buildReversalMarkers([sig({ signalDate: '2026-07-20' })], bars);
    const [c] = buildReversalMarkers([sig({ signalDate: '2026-07-20', state: 'confirmed', resolvedDate: '2026-07-22' })], bars);
    const [f] = buildReversalMarkers([sig({ signalDate: '2026-07-20', state: 'failed', resolvedDate: '2026-07-22' })], bars);
    expect([p.glyph, c.glyph, f.glyph]).toEqual([
      REVERSAL_GLYPH.bullish.pending, REVERSAL_GLYPH.bullish.confirmed, REVERSAL_GLYPH.bullish.failed,
    ]);
    expect(new Set([p.glyph, c.glyph, f.glyph]).size).toBe(3);
    expect(f.stateLabel).toBe('已失效');
  });

  it('aria-label 含日期、型態、狀態與觸發價', () => {
    const [m] = buildReversalMarkers([sig({ signalDate: '2026-07-22' })], bars);
    expect(m.ariaLabel).toBe('2026/07/22 低檔放量長下影 待確認，站上 118.00 才確認');
  });

  it('active 只標記摘要選用的那一個', () => {
    const a = sig({ signalDate: '2026-07-21' });
    const b = sig({ signalDate: '2026-07-23' });
    const ms = buildReversalMarkers([a, b], bars, b);
    expect(ms.map((m) => m.active)).toEqual([false, true]);
  });

  it('顯示區間外的訊號直接丟棄，同日只取一個', () => {
    const ms = buildReversalMarkers(
      [sig({ signalDate: '2026-06-01' }), sig({ signalDate: '2026-07-22' }), sig({ signalDate: '2026-07-22', kind: 'bullish_engulfing' })],
      bars,
    );
    expect(ms).toHaveLength(1);
    expect(ms[0].date).toBe('2026-07-22');
  });

  it('沒有 bars 或沒有訊號時回空陣列（不佔位）', () => {
    expect(buildReversalMarkers([sig({})], [])).toEqual([]);
    expect(buildReversalMarkers([], bars)).toEqual([]);
    expect(buildReversalMarkers(null, bars)).toEqual([]);
  });
});

describe('reversalConfirmText / reversalTooltipByDate', () => {
  it('pending / confirmed / failed 文案各異', () => {
    expect(reversalConfirmText(sig({}))).toBe('站上 118.00 才確認');
    expect(reversalConfirmText(sig({ state: 'confirmed', resolvedDate: '2026-07-25' })))
      .toBe('已於 2026/07/25 站上 118.00 確認');
    expect(reversalConfirmText(sig({ state: 'failed', resolvedDate: '2026-07-24' })))
      .toBe('已失效（2026/07/24 反向跌破）');
    expect(reversalConfirmText(sig({ direction: 'bearish', kind: 'shooting_star' })))
      .toBe('跌破 118.00 才確認');
  });

  it('tooltip 映射含型態、狀態與確認條件', () => {
    const map = reversalTooltipByDate([sig({ signalDate: '2026-07-20' })]);
    expect(map['2026-07-20']).toBe('低檔放量長下影 · 待確認 · 站上 118.00 才確認');
  });
});
