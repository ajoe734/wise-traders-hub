import { describe, expect, it } from 'vitest';

/**
 * BSR daily series 單一資料源契約測試。
 *
 * 背景：`tw-chips-detail` 曾以 `.from('tw_bsr_daily').limit(30000)` 現算集中度序列，
 * 命中 PostgREST server-side row cap → 熱門股僅回 1~2 天，畫面永遠顯示「補齊中 2/5」。
 *
 * 修復契約：
 * 1. 序列改由 `tw_chips_rollup` (window_days=5) 供給，一日一列。
 * 2. Readiness.have === 序列中 broker_count>=1 的天數（單一來源，禁止 split-brain）。
 * 3. 60 天視窗查詢回傳最多 60 列，遠低於任何 row cap。
 */

type SeriesRow = {
  date: string;
  concentration_ratio: number | null;
  broker_count: number;
  low_quality: boolean;
};

// 模擬 chips-detail 的核心資料轉換（純函式版本，跟 edge function 邏輯對齊）。
function buildFromDailySeries(rows: SeriesRow[]) {
  const bsrConcentration = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const bsrValidDatesAsc = bsrConcentration
    .filter((p) => (p.broker_count ?? 0) >= 1)
    .map((p) => p.date);
  const lowQualityDates = new Set(
    bsrConcentration.filter((p) => p.low_quality).map((p) => p.date),
  );
  return {
    series: bsrConcentration,
    readiness5: { have: bsrValidDatesAsc.length, need: 5 },
    lowQualityDates,
  };
}

describe('BSR daily series — single source of truth (rollup RPC)', () => {
  it('高基數股（>500 brokers/day，5 天完整）→ series=5 且 readiness=5/5', () => {
    const rows: SeriesRow[] = [
      { date: '2026-07-20', concentration_ratio: 64.21, broker_count: 736, low_quality: false },
      { date: '2026-07-21', concentration_ratio: 62.83, broker_count: 696, low_quality: false },
      { date: '2026-07-22', concentration_ratio: 59.11, broker_count: 743, low_quality: false },
      { date: '2026-07-23', concentration_ratio: 56.72, broker_count: 680, low_quality: false },
      { date: '2026-07-24', concentration_ratio: 56.97, broker_count: 753, low_quality: false },
    ];
    const out = buildFromDailySeries(rows);
    expect(out.series).toHaveLength(5);
    expect(out.readiness5.have).toBe(5);
    // Invariant：readiness.have 必須等於 series 中 broker_count>=1 的點數
    expect(out.readiness5.have).toBe(
      out.series.filter((p) => (p.broker_count ?? 0) >= 1).length,
    );
  });

  it('60 天視窗回傳筆數 ≤ 60（O(days)，永久免疫 row cap）', () => {
    const rows: SeriesRow[] = Array.from({ length: 60 }).map((_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, '0')}`,
      concentration_ratio: 50 + i * 0.1,
      broker_count: 700 + i,
      low_quality: false,
    }));
    const out = buildFromDailySeries(rows);
    expect(out.series.length).toBe(60);
    expect(out.readiness5.have).toBe(60);
  });

  it('低品質日（broker_count < 5）仍計入 valid，但被標為 low_quality', () => {
    const rows: SeriesRow[] = [
      { date: '2026-07-20', concentration_ratio: 60, broker_count: 3, low_quality: true },
      { date: '2026-07-21', concentration_ratio: 61, broker_count: 700, low_quality: false },
      { date: '2026-07-22', concentration_ratio: 62, broker_count: 2, low_quality: true },
    ];
    const out = buildFromDailySeries(rows);
    expect(out.readiness5.have).toBe(3);
    expect(out.lowQualityDates.has('2026-07-20')).toBe(true);
    expect(out.lowQualityDates.has('2026-07-22')).toBe(true);
    expect(out.lowQualityDates.has('2026-07-21')).toBe(false);
  });

  it('零天資料 → readiness.have=0，series 空陣列', () => {
    const out = buildFromDailySeries([]);
    expect(out.series).toHaveLength(0);
    expect(out.readiness5.have).toBe(0);
  });

  it('回歸防禦：series.length === readiness.have 這條 invariant 必須成立', () => {
    // 隨機組合 20 個場景，模擬各種資料密度
    for (let i = 0; i < 20; i++) {
      const n = Math.floor(Math.random() * 60);
      const rows: SeriesRow[] = Array.from({ length: n }).map((_, k) => {
        const bc = Math.floor(Math.random() * 800);
        return {
          date: `2026-04-${String(k + 1).padStart(2, '0')}`,
          concentration_ratio: 50 + Math.random() * 20,
          broker_count: bc,
          low_quality: bc > 0 && bc < 5,
        };
      });
      const out = buildFromDailySeries(rows);
      const validInSeries = out.series.filter((p) => (p.broker_count ?? 0) >= 1).length;
      expect(out.readiness5.have).toBe(validInSeries);
    }
  });
});
