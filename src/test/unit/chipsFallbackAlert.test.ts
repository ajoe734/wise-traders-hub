import { describe, expect, it } from 'vitest';
import {
  evaluateAllWaves,
  evaluateWave,
  FALLBACK_RATE_THRESHOLD,
  type KeepwarmMetric,
} from '../../../supabase/functions/_shared/chipsFallbackAlert.ts';

const base: Omit<KeepwarmMetric, 'wave' | 'trade_date' | 'started_at'> = {
  status: 'sealed',
  sealed: true,
  sealed_by_lane: 'finmind_market_batch',
  coverage_stocks: 200,
  coverage_brokers: 800,
  fallback_used_count: 0,
  duration_ms: 3200,
  error: null,
};

const row = (
  wave: number,
  offsetMin: number,
  overrides: Partial<KeepwarmMetric> = {},
): KeepwarmMetric => ({
  ...base,
  wave,
  trade_date: '2026-07-27',
  started_at: new Date(Date.now() - offsetMin * 60_000).toISOString(),
  ...overrides,
});

describe('chipsFallbackAlert.evaluateWave', () => {
  it('少於 3 筆時不觸發', () => {
    const d = evaluateWave([row(1, 5), row(1, 10)]);
    expect(d.triggered).toBe(false);
    expect(d.samples).toBe(2);
  });

  it('連續 3 波都 sealed=false → 觸發 sealed_false', () => {
    const d = evaluateWave([
      row(1, 5, { sealed: false, status: 'partial' }),
      row(1, 65, { sealed: false, status: 'partial' }),
      row(1, 125, { sealed: false, status: 'partial' }),
    ]);
    expect(d.triggered).toBe(true);
    expect(d.reason).toBe('sealed_false');
  });

  it('連續 3 波 fallback 都 > 30% 但已 sealed → 觸發 fallback_high', () => {
    const d = evaluateWave([
      row(2, 5, { fallback_used_count: 80 }),
      row(2, 65, { fallback_used_count: 90 }),
      row(2, 125, { fallback_used_count: 100 }),
    ]);
    expect(d.triggered).toBe(true);
    expect(d.reason).toBe('fallback_high');
    expect(d.fallback_rate_avg).toBeGreaterThan(FALLBACK_RATE_THRESHOLD);
  });

  it('sealed=false + fallback 高 → 標為 mixed', () => {
    const d = evaluateWave([
      row(3, 5, { sealed: false, status: 'partial', fallback_used_count: 100 }),
      row(3, 65, { sealed: false, status: 'partial', fallback_used_count: 120 }),
      row(3, 125, { sealed: false, status: 'partial', fallback_used_count: 90 }),
    ]);
    expect(d.reason).toBe('mixed');
  });

  it('coverage_stocks=0 視為 fallback_rate=1', () => {
    const d = evaluateWave([
      row(1, 5, { coverage_stocks: 0, fallback_used_count: 0 }),
      row(1, 65, { coverage_stocks: 0 }),
      row(1, 125, { coverage_stocks: 0 }),
    ]);
    expect(d.triggered).toBe(true);
    // 三筆同時 sealed=true(base) 但 coverage=0 → rate=1 > threshold
    expect(d.reason).toBe('fallback_high');
  });

  it('status=error 一律當失敗計算', () => {
    const d = evaluateWave([
      row(1, 5, { status: 'error', sealed: true }),
      row(1, 65, { status: 'error', sealed: true }),
      row(1, 125, { status: 'error', sealed: true }),
    ]);
    expect(d.reason).toBe('mixed');
  });

  it('健康三波不觸發', () => {
    const d = evaluateWave([
      row(1, 5, { fallback_used_count: 10 }),
      row(1, 65, { fallback_used_count: 15 }),
      row(1, 125, { fallback_used_count: 5 }),
    ]);
    expect(d.triggered).toBe(false);
  });

  it('只取最新 3 筆，較舊的無效點被忽略', () => {
    const d = evaluateWave([
      row(1, 5, { fallback_used_count: 10 }),
      row(1, 65, { fallback_used_count: 15 }),
      row(1, 125, { fallback_used_count: 5 }),
      // 舊的壞資料
      row(1, 900, { sealed: false, status: 'partial', fallback_used_count: 200 }),
    ]);
    expect(d.triggered).toBe(false);
  });
});

describe('chipsFallbackAlert.evaluateAllWaves', () => {
  it('按 wave 分組並回傳排序後的決策', () => {
    const decisions = evaluateAllWaves([
      row(1, 5), row(1, 65), row(1, 125),
      row(2, 5, { sealed: false, status: 'partial' }),
      row(2, 65, { sealed: false, status: 'partial' }),
      row(2, 125, { sealed: false, status: 'partial' }),
    ]);
    expect(decisions.map((d) => d.wave)).toEqual([1, 2]);
    expect(decisions[0].triggered).toBe(false);
    expect(decisions[1].triggered).toBe(true);
  });
});
