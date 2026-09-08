/**
 * CHIPS_DATA_20260908 · 卡片籌碼行必須以「實際可得的最新籌碼事實」為準
 *
 * 真實生產狀況（2026-09-08）：
 *   - 三大法人（TWSE T86 / TPEx）as_of = 2026-09-07（新鮮，每交易日持續同步）
 *   - 券商分點 BSR = provider 方案被上游永久拒絕，最後可得 2026-08-14
 *
 * 舊行為：卡片只讀 BSR，整張卡顯示「籌碼資料暫時無法取得 · 顯示最後可得資料 2026/08/14」，
 * 讓使用者以為整個籌碼面停更三週——事實上法人資料是當日的。
 *
 * 契約：
 *   1. 有新鮮法人資料時，卡片主文案顯示法人日期與外資淨額（真資料，非 mock、非 0 冒充）。
 *   2. BSR terminal 仍必須誠實標示，但只能是附註，不能蓋掉法人事實。
 *   3. 完全沒有任何籌碼事實時，維持既有 BSR 文案，不得留白。
 */
import { describe, it, expect } from 'vitest';
import { resolveCardChipsLine } from '@/checkup/lib/cardChipsLine';

const INST_FRESH = {
  as_of: '2026-09-07',
  as_of_lag_days: 1,
  institutional: { d1: { foreign_net: -424791, trust_net: -14000, dealer_net: 5911, total_net: -432880, days_covered: 1 } },
  bsr_as_of: '2026-08-14',
  bsr_provider_state: 'terminal_provider_rejected',
};

describe('卡片籌碼行 · 法人優先', () => {
  it('法人新鮮 + BSR terminal → 顯示法人日期與外資淨額，BSR 只是附註', () => {
    const line = resolveCardChipsLine(INST_FRESH as any, 'unavailable_unsupported');
    expect(line.kind).toBe('institutional');
    expect(line.instAsOf).toBe('2026-09-07');
    expect(line.text).toContain('2026/09/07');
    expect(line.text).toContain('外資');
    expect(line.text).toContain('-425');
    expect(line.text).toContain('券商分點');
    // 絕不能讓 8/14 變成整段籌碼面的代表日期
    expect(line.text.startsWith('籌碼資料暫時無法取得')).toBe(false);
  });

  it('法人新鮮 + BSR 正常 → 只顯示法人行，不加附註', () => {
    const line = resolveCardChipsLine(
      { ...INST_FRESH, bsr_as_of: '2026-09-07', bsr_provider_state: null } as any,
      'available',
    );
    expect(line.kind).toBe('institutional');
    expect(line.text).not.toContain('券商分點');
  });

  it('法人淨額為 0 不得當成「有資料」冒充：仍顯示日期但標為 0 張', () => {
    const line = resolveCardChipsLine(
      { as_of: '2026-09-07', institutional: { d1: { foreign_net: 0, days_covered: 1 } } } as any,
      'available',
    );
    expect(line.kind).toBe('institutional');
    expect(line.text).toContain('2026/09/07');
  });

  it('無任何法人資料 → 退回既有 BSR 文案', () => {
    const line = resolveCardChipsLine(
      { bsr_as_of: '2026-08-14', bsr_provider_state: 'terminal_provider_rejected' } as any,
      'unavailable_unsupported',
    );
    expect(line.kind).toBe('bsr');
    expect(line.text).toBe('籌碼資料暫時無法取得 · 顯示最後可得資料 2026/08/14');
  });

  it('payload 為 null → 空字串（loading 不顯示）', () => {
    expect(resolveCardChipsLine(null, 'loading').text).toBe('');
  });
});
