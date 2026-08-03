import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getSparkOhlc, deriveOhlc, deriveSparkline } from '@/checkup/lib/holdingDetailViewModel';
import { sparklineCache } from '@/checkup/hooks/useSparklines';

/**
 * 真實 Demo 抽屜量能資料流：
 *   checkup-sparkline response → SparklineEntry → PriceBar.volume。
 * production Demo 禁止使用假量，這裡只驗 mapping / 對齊 / cache version。
 */

// checkup-sparkline v2 的實際回傳形狀（volume 單位＝股）
const RESPONSE = {
  result: {
    '3443': {
      ohlc: [
        { date: '2026-07-30', open: 4200, high: 4300, low: 4180, close: 4290, volume: 1_306_000 },
        { date: '2026-07-31', open: 4290, high: 4400, low: 4280, close: 4380, volume: 1_981_000 },
      ],
      closes: [4290, 4380],
    },
  },
};

describe('Demo 抽屜成交量資料流', () => {
  it('history response → PriceBar.volume 原樣帶入（不補值、不縮放）', () => {
    const bars = getSparkOhlc(RESPONSE.result['3443'] as any);
    expect(bars).toHaveLength(2);
    expect(bars.map((b) => b.volume)).toEqual([1_306_000, 1_981_000]);
  });

  it('trade_date 對齊：bars 順序與 date 遞增一致', () => {
    const bars = deriveOhlc(RESPONSE.result['3443'] as any, { code: '3443' });
    expect(bars.map((b) => b.date)).toEqual(['2026-07-30', '2026-07-31']);
  });

  it('取不到真實量時 volume 為 null（合成 K 棒不得捏造量）', () => {
    const holding = { code: '3443', cost: 100, price: 120 };
    const bars = deriveOhlc(null, holding, deriveSparkline(null, holding));
    expect(bars.length).toBeGreaterThan(2);
    expect(bars.every((b) => b.volume == null)).toBe(true);
  });

  it('sparkline 快取 namespace 為帶 volume 的 v2', () => {
    sparklineCache.set('3443', RESPONSE.result['3443'] as any);
    const hit = sparklineCache.get('3443');
    expect(hit?.ohlc?.[1]?.volume).toBe(1_981_000);
  });

  it('Demo 模式不得停用 sparkline 取數（真實 OHLCV 才有量柱）', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/checkup/components/freecheckup/HoldingsWorkbench.tsx'),
      'utf8',
    );
    const call = src.match(/useSparklines\([^)]*\)/)?.[0] ?? '';
    expect(call).toBeTruthy();
    expect(call).not.toContain('isDemo');
  });
});
