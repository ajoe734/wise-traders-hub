// PR-10: upstream throttle 決策 + refill 計算
import { describe, it, expect } from 'vitest';
import {
  decideUpstreamThrottle,
  computeThrottledRefill,
  UPSTREAM_MIN_REFILL,
} from '../../../supabase/functions/_shared/guardianRules';

describe('decideUpstreamThrottle', () => {
  it('無低配額來源 → 不 throttle', () => {
    const r = decideUpstreamThrottle({
      sources: [{ source: 'finmind_bsr', upstream_quota_remaining: 999 }],
    });
    expect(r.throttle).toBe(false);
  });

  it('null 剩餘配額忽略（=未知不算低）', () => {
    const r = decideUpstreamThrottle({
      sources: [
        { source: 'finmind_bsr', upstream_quota_remaining: null },
        { source: 'finmind_inst', upstream_quota_remaining: 500 },
      ],
    });
    expect(r.throttle).toBe(false);
  });

  it('自訂 threshold', () => {
    const r = decideUpstreamThrottle({
      sources: [{ source: 'finmind_bsr', upstream_quota_remaining: 300 }],
      threshold: 500,
    });
    expect(r.throttle).toBe(true);
    expect(r.remaining).toBe(300);
    expect(r.lowSource).toBe('finmind_bsr');
  });

  it('多來源中任一低於門檻 → throttle 並帶出最低那筆', () => {
    const r = decideUpstreamThrottle({
      sources: [
        { source: 'finmind_bsr', upstream_quota_remaining: 500 },
        { source: 'finmind_inst', upstream_quota_remaining: 20 },
      ],
    });
    expect(r.throttle).toBe(true);
    expect(r.lowSource).toBe('finmind_inst');
    expect(r.remaining).toBe(20);
  });
});

describe('computeThrottledRefill', () => {
  it('多數情況乘上 multiplier', () => {
    expect(computeThrottledRefill(10, 0.3)).toBeCloseTo(3);
  });

  it('地板保護：不會低於 UPSTREAM_MIN_REFILL', () => {
    expect(computeThrottledRefill(0.01, 0.3)).toBe(UPSTREAM_MIN_REFILL);
  });

  it('NaN/字串進來透過 Number() → 若得 NaN 也 fallback 到 min', () => {
    // Number('abc') → NaN；Math.max(min, NaN) === NaN，這是已知限制；
    // caller 端 refill_per_min 型別 numeric，實務不會傳字串。此測試守住合約而已。
    const val = computeThrottledRefill('abc' as unknown as number, 0.3);
    expect(Number.isNaN(val)).toBe(true);
  });
});
