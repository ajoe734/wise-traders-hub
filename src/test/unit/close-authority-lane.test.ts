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
  const fake = createFakeGateway({});
  setCheckupGateway({
    ...fake,
    invoke: (async (fn: string) => {
      invokes.push(fn);
      if (fn === 'checkup-sparkline') {
        if (behavior === 'throw') throw new Error('boom');
        if (behavior === 'absent') return { result: null };
        return { result: {} };
      }
      return { data: [] };
    }) as any,
  } as any);
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

/**
 * StrictMode dispose-probe 回歸（FreeCheckup.jsx autoDisposedRef）。
 *
 * 生產 bug：舊版 effect 只有 cleanup 設 true、沒有 setup 重設，
 * StrictMode 的 setup→cleanup(true)→setup 之後 ref 永久 true，
 * runAutoRefresh 完成後提前 return，authorityDoneRef 永遠不記 fingerprint，
 * 5 分鐘 periodic 會再次打 checkup-sparkline。
 *
 * 此處用與 FreeCheckup.jsx L1601+ 相同的 effect 形狀做 executable probe，
 * 並以 source contract 鎖住兩邊不漂移。
 */
import React, { useEffect, useRef } from 'react';
import { render, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('autoDisposedRef — source contract（防止與 FreeCheckup.jsx 漂移）', () => {
  const src = readFileSync(resolve(__dirname, '../../pages/FreeCheckup.jsx'), 'utf8');
  it('effect setup 明確重設 false、cleanup 才設 true', () => {
    const m = src.match(/autoDisposedRef[\s\S]{0,400}?useEffect\(\(\) => \{([\s\S]*?)\}, \[\]\);/);
    expect(m).toBeTruthy();
    const body = m![1];
    const setupIdx = body.indexOf('autoDisposedRef.current = false');
    const cleanupIdx = body.indexOf('autoDisposedRef.current = true');
    expect(setupIdx).toBeGreaterThanOrEqual(0);
    expect(cleanupIdx).toBeGreaterThan(setupIdx); // cleanup 在 setup 之後
  });
});

describe('autoDisposedRef — StrictMode executable probe', () => {
  type Done = { fps: string[]; disposedAtMark: boolean[] };
  function makeHarness(done: Done) {
    const observed: { markedAfterProbe: boolean; invokeCount: () => number } = {
      markedAfterProbe: false,
      invokeCount: () => invokes.length,
    };
    // 與 FreeCheckup.jsx 相同的 effect / 完成標記邏輯（見 source contract 測試）
    function Probe({ settle }: { settle: (v: unknown) => void }) {
      const authorityDoneRef = useRef(new Set<string>());
      const autoDisposedRef = useRef(false);
      useEffect(() => {
        autoDisposedRef.current = false;
        return () => { autoDisposedRef.current = true; };
      }, []);
      useEffect(() => {
        let cancelled = false;
        (async () => {
          const out = await new Promise<any>((res) => settle(res)); // 模擬 refreshPrices
          void cancelled;
          if (autoDisposedRef.current) { done.disposedAtMark.push(true); return; }
          if (out?.kind === 'attempted' && out.lane === 'settled' && out.transport === 'ok' && out.fingerprint) {
            authorityDoneRef.current.add(out.fingerprint);
            done.fps.push(out.fingerprint);
            observed.markedAfterProbe = true;
          }
        })();
      }, [settle]);
      return null;
    }
    return { Probe, observed };
  }

  it('StrictMode effect probe 後，一次 transport ok 仍能記 fingerprint；unmount 後 completion 不寫 ref', async () => {
    const done: Done = { fps: [], disposedAtMark: [] };
    const { Probe, observed } = makeHarness(done);
    let settleFn!: (v: unknown) => void;
    const settle = (res: (v: unknown) => void) => { settleFn = res; };

    const utils = render(
      React.createElement(React.StrictMode, null, React.createElement(Probe, { settle })),
    );
    // probe 已跑過 setup→cleanup(true)→setup；async 還在等
    expect(done.fps).toEqual([]);

    await act(async () => {
      settleFn({ kind: 'attempted', lane: 'settled', transport: 'ok', fingerprint: '2026-08-28:2330' });
    });
    expect(done.fps).toEqual(['2026-08-28:2330']);
    expect(observed.markedAfterProbe).toBe(true);
    expect(done.disposedAtMark).toEqual([]); // probe cleanup 後第二次 setup 有重設 false

    // unmount 後的 async completion 不得寫 ref/state
    let settleFn2!: (v: unknown) => void;
    const utils2 = render(React.createElement(Probe, { settle: (res: (v: unknown) => void) => { settleFn2 = res; } }));
    utils2.unmount();
    const before = done.fps.length;
    await act(async () => {
      settleFn2({ kind: 'attempted', lane: 'settled', transport: 'ok', fingerprint: '2026-08-28:2330' });
    });
    expect(done.fps.length).toBe(before);
    expect(done.disposedAtMark.length).toBeGreaterThan(0);
    utils.unmount();
    void observed.invokeCount;
  });
});

describe('autoDisposedRef — StrictMode 下 periodic 累計 invoke 仍為 1', () => {
  it('首次 transport ok 記 fingerprint；+5min、+30min periodic 不再打 Edge', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(SETTLED);
    try {
      const fp = closeAuthorityFingerprint('2026-08-28', [{ code: '2330' }]);
      const gateCalls: string[] = [];
      let doneRef: { has: (k: string) => boolean; add: (k: string) => void } | null = null;
      let disposedRef: { current: boolean } | null = null;

      function PeriodicProbe() {
        const authorityDoneRef = useRef(new Set<string>());
        const autoDisposedRef = useRef(false);
        doneRef = authorityDoneRef.current;
        disposedRef = autoDisposedRef;
        useEffect(() => {
          autoDisposedRef.current = false;
          return () => { autoDisposedRef.current = true; };
        }, []);
        return null;
      }
      const runPeriodic = async () => {
        // 與 runAutoRefresh 相同 gate：settled + fingerprint 已完成 → 整次跳過（0 Edge）
        if (authorityDoneRefHas(fp)) return;
        const out = await (async () => {
          invokes.push('checkup-sparkline'); // 實際打 Edge 才計數
          return { kind: 'attempted', lane: 'settled', transport: 'ok', fingerprint: fp };
        })();
        if (disposedRef!.current) return;
        if (out.transport === 'ok' && out.fingerprint) doneRef!.add(out.fingerprint);
        gateCalls.push(fp);
      };
      const authorityDoneRefHas = (k: string) => doneRef!.has(k);

      render(
        React.createElement(React.StrictMode, null, React.createElement(PeriodicProbe)),
      );
      expect(closeAuthorityLane(new Date(), 'TW')).toBe('settled');

      const t0 = invokes.length;
      await runPeriodic();                       // 首次 auto：打 1 次、記完成
      expect(invokes.length).toBe(t0 + 1);
      expect(doneRef!.has(fp)).toBe(true);

      vi.setSystemTime(new Date(SETTLED.getTime() + 5 * 60 * 1000));
      await runPeriodic();                       // 5 分鐘 stale periodic：skip
      expect(invokes.length).toBe(t0 + 1);

      vi.setSystemTime(new Date(SETTLED.getTime() + 30 * 60 * 1000));
      await runPeriodic();                       // 30 分鐘後：仍 skip
      expect(invokes.length).toBe(t0 + 1);
      expect(gateCalls).toEqual([fp]);           // 只有一次真的完成
    } finally {
      vi.useRealTimers();
    }
  });
});
