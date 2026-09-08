/**
 * 卡片籌碼選擇器紅→綠測試。
 * 斷言 actual rows/source/freshness 決定輸出，而不是文案。
 */
import { describe, it, expect } from 'vitest';
import {
  resolveCardChipsFact,
  sharesToLots,
  formatLots,
  BSR_TEXT_ENTITLEMENT,
} from '@/checkup/lib/cardChipsFact';
import type { ChipsFetchResult } from '@/checkup/lib/chipsRepository';

function mk(payload: Record<string, unknown> | null): ChipsFetchResult {
  return { payload } as unknown as ChipsFetchResult;
}

const INST_D1 = { foreign_net: -424791, trust_net: -14000, dealer_net: 5911, total_net: -432880, days_covered: 1 };

const FRESH_INST_STALE_BSR = mk({
  stock_id: '2478',
  as_of: '2026-09-07',
  as_of_lag_days: 1,
  institutional: { d1: INST_D1, d5: null, d20: null, d60: null },
  bsr: { d5: null, d20: null, d60: null },
  bsr_as_of: '2026-08-14',
  bsr_freshness_status: 'syncing',
  bsr_provider_state: 'terminal_provider_rejected',
  bsr_provider_code: 'provider_plan_rejected',
});

describe('resolveCardChipsFact', () => {
  it('fresh 法人 + blocked BSR：法人為 primary，分點只在 secondary', () => {
    const f = resolveCardChipsFact(FRESH_INST_STALE_BSR, { kind: 'ok' });
    expect(f.kind).toBe('institutional');
    expect(f.asOf).toBe('2026/09/07');
    expect(f.lots).toEqual({ foreign: -425, trust: -14, dealer: 5.9, total: -433 });
    expect(f.text).toContain('外資 −425');
    expect(f.text).toContain('投信 −14');
    expect(f.text).toContain('自營 +5.9');
    expect(f.text).toContain('張');
    expect(f.text).not.toContain('無法取得');
    expect(f.secondaryText).toBe(`${BSR_TEXT_ENTITLEMENT} · 最後可得 2026/08/14`);
    expect(f.bsrAsOf).toBe('2026-08-14');
  });

  it('兩者皆缺：fail-closed，不顯示任何數值', () => {
    const f = resolveCardChipsFact(
      mk({ stock_id: '2478', as_of: null, institutional: { d1: null }, bsr_as_of: null }),
      { kind: 'ok' },
    );
    expect(f.kind).not.toBe('institutional');
    expect(f.lots).toBeNull();
    expect(f.text).not.toMatch(/\d/);
  });

  it('法人 rows 存在但 days_covered=0：視為無資料，不得顯示 0 張', () => {
    const f = resolveCardChipsFact(
      mk({
        stock_id: '2478',
        as_of: '2026-09-07',
        institutional: { d1: { foreign_net: 0, trust_net: 0, dealer_net: 0, total_net: 0, days_covered: 0 } },
        bsr_as_of: '2026-08-14',
        bsr_provider_state: 'terminal_provider_rejected',
      }),
      { kind: 'ok' },
    );
    expect(f.kind).toBe('bsr_status');
    expect(f.lots).toBeNull();
  });

  it('ETF／權證 ineligible：不適用優先於法人數值', () => {
    const f = resolveCardChipsFact(
      mk({
        stock_id: '0050',
        as_of: '2026-09-07',
        institutional: { d1: INST_D1 },
        bsr_as_of: null,
        bsr_provider_state: 'ineligible',
      }),
      { kind: 'ok' },
    );
    expect(f.kind).toBe('not_applicable');
    expect(f.lots).toBeNull();
  });

  it('非台股 batch not_applicable：不適用', () => {
    const f = resolveCardChipsFact(mk(null), { kind: 'not_applicable' });
    expect(f.kind).toBe('not_applicable');
  });

  it('尚未載入：loading，無文字', () => {
    const f = resolveCardChipsFact(null, null);
    expect(f.kind).toBe('loading');
    expect(f.text).toBe('');
  });

  it('法人落後多日仍顯示，但標示落後天數（日期／時區不得憑空前進）', () => {
    const f = resolveCardChipsFact(
      mk({
        stock_id: '2478',
        as_of: '2026-08-29',
        as_of_lag_days: 9,
        institutional: { d1: INST_D1 },
        bsr_as_of: '2026-08-14',
        bsr_provider_state: 'terminal_provider_rejected',
      }),
      { kind: 'ok' },
    );
    expect(f.text).toContain('2026/08/29');
    expect(f.text).toContain('落後 9 日');
  });

  it('張數換算：正負與小量精度', () => {
    expect(sharesToLots(1_530_914)).toBe(1531);
    expect(sharesToLots(-424_791)).toBe(-425);
    expect(sharesToLots(5_911)).toBe(5.9);
    expect(formatLots(0)).toBe('0');
    expect(formatLots(1_530_914)).toBe('+1,531');
    expect(formatLots(-424_791)).toBe('−425');
  });
});
