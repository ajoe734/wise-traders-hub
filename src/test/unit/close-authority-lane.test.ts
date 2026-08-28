/**
 * V5 — close-authority lane / fingerprint 契約。
 *
 * 鎖住三件事：
 *  1. 只有 settled lane（且 allowAuthority）才會呼叫 checkup-sparkline；
 *     盤中／結算緩衝一律 0 次 Edge，主畫面維持即時價。
 *  2. transport（ok / throw / absent）必須來自可觀測的 gateway 結果，
 *     caller 才能據此決定 one-shot 是否記為完成。
 *  3. fingerprint = expected 交易日 + 排序後 TW 代號集合；
 *     只改 qty/price 不得產生新 fingerprint，新增代號才可以。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setCheckupGateway, resetCheckupGateway, createFakeGateway } from '@/checkup/lib/gateway';
import { setMarketHolidays, resetMarketHolidays, closeAuthorityLane } from '@/checkup/lib/marketCalendar';
import { fetchAuthoritativeQuotesDetailed } from '@/checkup/lib/authoritativeQuotes';
import {
  closeAuthorityFingerprint,
  needsCloseAuthorityRefresh,
  isTwHoldingCode,
} from '@/checkup/lib/closeAlignment';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from() {
      const b: any = {
        select: () => b,
        in: () => b,
        eq: () => b,
        then: (resolve: (v: any) => void) => Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return b;
    },
  },
}));

// 2026-08-28（五）台北時間
const INTRADAY = new Date('2026-08-28T03:00:00Z');   // 11:00 盤中
const SETTLING = new Date('2026-08-28T05:45:00Z');   // 13:45 結算緩衝
const SETTLED = new Date('2026-08-28T14:55:00Z');    // 22:55 已定版
const WEEKEND = new Date('2026-08-29T02:00:00Z');    // 週六 10:00

let invokes: string[] = [];

function installGateway(behavior: 'ok' | 'throw' | 'absent') {
  invokes = [];
  setCheckupGateway(
    createFakeGateway({
      invoke: async (fn: string) => {
        invokes.push(fn);
        if (fn === 'checkup-sparkline') {
          if (behavior === 'throw') throw new Error('boom');
          if (behavior === 'absent') return { result: null };
          return { result: {} };
        }
        return { data: [] };
      },
    } as any),
  );
}

beforeEach(() => {
  resetMarketHolidays();
  setMarketHolidays(['2026-01-01'], 'TW');
  installGateway('ok');
});

afterEach(() => {
  resetCheckupGateway();
  resetMarketHolidays();
});

describe('closeAuthorityLane', () => {
  it('盤中 → intraday；結算緩衝 → settling；收盤定版／週末 → settled', () => {
    expect(closeAuthorityLane(INTRADAY, 'TW')).toBe('intraday');
    expect(closeAuthorityLane(SETTLING, 'TW')).toBe('settling');
    expect(closeAuthorityLane(SETTLED, 'TW')).toBe('settled');
    expect(closeAuthorityLane(WEEKEND, 'TW')).toBe('settled');
  });

  it('休市日表未載入 → unknown，且不得宣稱已確認', () => {
    resetMarketHolidays();
    expect(closeAuthorityLane(SETTLED, 'TW')).toBe('unknown');
  });
});

describe('fetchAuthoritativeQuotesDetailed — Edge 呼叫次數', () => {
  it('intraday：0 次 checkup-sparkline', async () => {
    const { meta } = await fetchAuthoritativeQuotesDetailed(['2330'], INTRADAY);
    expect(meta.lane).toBe('intraday');
    expect(invokes.filter((f) => f === 'checkup-sparkline')).toHaveLength(0);
    expect(meta.attempted).toBe(false);
  });

  it('settling：0 次 checkup-sparkline', async () => {
    const { meta } = await fetchAuthoritativeQuotesDetailed(['2330'], SETTLING);
    expect(meta.lane).toBe('settling');
    expect(invokes.filter((f) => f === 'checkup-sparkline')).toHaveLength(0);
    expect(meta.attempted).toBe(false);
  });

  it('settled：恰 1 次，transport=ok', async () => {
    const { meta } = await fetchAuthoritativeQuotesDetailed(['2330'], SETTLED);
    expect(meta.lane).toBe('settled');
    expect(invokes.filter((f) => f === 'checkup-sparkline')).toHaveLength(1);
    expect(meta.attempted).toBe(true);
    expect(meta.transport).toBe('ok');
  });

  it('settled + allowAuthority=false：0 次 Edge、attempted=false', async () => {
    const { meta } = await fetchAuthoritativeQuotesDetailed(['2330'], SETTLED, { allowAuthority: false });
    expect(invokes.filter((f) => f === 'checkup-sparkline')).toHaveLength(0);
    expect(meta.attempted).toBe(false);
    expect(meta.transport).toBeNull();
  });

  it('transport throw / absent 都必須誠實回報（caller 不得記為完成）', async () => {
    installGateway('throw');
    expect((await fetchAuthoritativeQuotesDetailed(['2330'], SETTLED)).meta.transport).toBe('throw');
    installGateway('absent');
    expect((await fetchAuthoritativeQuotesDetailed(['2330'], SETTLED)).meta.transport).toBe('absent');
  });

  it('沒有 confirmed 收盤時不得偽造 confirmed 身分', async () => {
    const { quotes } = await fetchAuthoritativeQuotesDetailed(['2330'], SETTLED);
    Object.values(quotes).forEach((q) => expect(q.state).not.toBe('confirmed'));
  });
});

describe('closeAuthorityFingerprint', () => {
  const rows = (codes: string[], extra: Record<string, unknown> = {}) =>
    codes.map((code) => ({ code, qty: 1000, price: 100, ...extra }));

  it('同一組代號（順序不同）→ 同一 fingerprint', () => {
    expect(closeAuthorityFingerprint('2026-08-28', rows(['2330', '3491'])))
      .toBe(closeAuthorityFingerprint('2026-08-28', rows(['3491', '2330'])));
  });

  it('只改 qty / price → fingerprint 不變', () => {
    const a = closeAuthorityFingerprint('2026-08-28', rows(['2330']));
    const b = closeAuthorityFingerprint('2026-08-28', rows(['2330'], { qty: 5000, price: 999 }));
    expect(b).toBe(a);
  });

  it('新增一檔 → fingerprint 改變（允許再一次 attempt）', () => {
    const a = closeAuthorityFingerprint('2026-08-28', rows(['2330']));
    const b = closeAuthorityFingerprint('2026-08-28', rows(['2330', '6505']));
    expect(b).not.toBe(a);
  });

  it('expected 交易日改變 → fingerprint 改變', () => {
    expect(closeAuthorityFingerprint('2026-08-27', rows(['2330'])))
      .not.toBe(closeAuthorityFingerprint('2026-08-28', rows(['2330'])));
  });

  it('非 TW 代號不進 fingerprint', () => {
    expect(closeAuthorityFingerprint('2026-08-28', rows(['2330', 'AAPL'])))
      .toBe(closeAuthorityFingerprint('2026-08-28', rows(['2330'])));
    expect(isTwHoldingCode('AAPL')).toBe(false);
    expect(isTwHoldingCode('2330')).toBe(true);
  });
});

describe('needsCloseAuthorityRefresh', () => {
  const pending = { code: '2330', priceState: 'pending', priceTradeDate: '2026-08-27' };
  const confirmed = { code: '2330', priceState: 'confirmed', priceTradeDate: '2026-08-28' };

  it('settled lane + 有 pending → true', () => {
    expect(needsCloseAuthorityRefresh([pending], SETTLED)).toBe(true);
  });

  it('settled lane + 全部已對齊 → false', () => {
    expect(needsCloseAuthorityRefresh([confirmed], SETTLED)).toBe(false);
  });

  it('盤中／結算緩衝一律 false（不搶即時價）', () => {
    expect(needsCloseAuthorityRefresh([pending], INTRADAY)).toBe(false);
    expect(needsCloseAuthorityRefresh([pending], SETTLING)).toBe(false);
  });

  it('空持股 → false', () => {
    expect(needsCloseAuthorityRefresh([], SETTLED)).toBe(false);
    expect(needsCloseAuthorityRefresh(null, SETTLED)).toBe(false);
  });
});
