/**
 * DEV-only Stage2 harness · 持倉 sparkline 的「台北 14:05 expected trade date 換日」封裝驗收面板。
 *
 * 硬性契約（不得偏離，否則這個 harness 就不是在驗 production）：
 *   - 掛載的是 **同一支 production** `useSparklines`（不複製、不 fork）；
 *   - expected trade date 來自 **同一顆** `expectedTradeDateStore`（透過 production hook 讀取），
 *     本檔 **不重算任何 boundary 邏輯**；
 *   - 時鐘只用既有 `installHarnessClock`（`fixedNow`），不手刻 `Date.now`；
 *   - 休市日走 canonical `setMarketHolidays()`（loader-ready seam），因此
 *     `expectedTradeDateStore` 不會呼叫 loader、不會碰 DB；
 *   - 對外握手一律 fake `CheckupGateway`，**絕不打真實 DB / Edge**。
 *
 * 「跨界」用 production 已有的恢復點觸發：換上新的 fixedNow 之後 dispatch
 * `visibilitychange`（store 的 `onVisibility` 會以「現在」重算 + 重排 timer）。
 * 這條路徑本來就是 production 的睡醒／回前景路徑，harness 沒有新增任何後門。
 *
 * URL: /e2e/holdings-detail-panel-volume?stage2=1
 */
import { useEffect, useRef, useState } from 'react';
import {
  setCheckupGateway,
  resetCheckupGateway,
  createFakeGateway,
  type FakeGateway,
} from '@/checkup/lib/gateway';
import { installHarnessClock, type HarnessClock } from '@/checkup/lib/harnessClock';
import { setMarketHolidays, resetMarketHolidays } from '@/checkup/lib/marketCalendar';
import { resetMarketHolidaysLoader } from '@/checkup/lib/marketHolidaysLoader';
import { __resetExpectedStoreForTests } from '@/checkup/lib/expectedTradeDateStore';
import { __resetSparklineTaskForTests } from '@/checkup/lib/sparklineFetchTask';
import {
  useSparklines,
  sparklineCache,
  sparklinePartialCache,
  sparklineFailCache,
} from '@/checkup/hooks/useSparklines';
import { useExpectedTradeDate } from '@/checkup/hooks/useExpectedTradeDate';

/** fixture：TW 三檔（含 ETF 與 6 碼）＋ US 兩檔。 */
export const STAGE2_CODES = ['2330', '00878', '911616', 'AMD', 'SOXL'];

/** 2026-08-26（週三）台北 14:04:59 → 尚未跨 14:05 結算界。 */
export const STAGE2_BEFORE_MS = Date.UTC(2026, 7, 26, 6, 4, 59);
/** 同一天台北 14:05:01 → 已跨界。 */
export const STAGE2_AFTER_MS = Date.UTC(2026, 7, 26, 6, 5, 1);

function bars(n = 25) {
  return Array.from({ length: n }, (_, i) => {
    const day = String(1 + i).padStart(2, '0');
    const close = 100 + i;
    return { date: `2026-08-${day}`, open: close, high: close, low: close, close, volume: 1_000_000 };
  });
}

function makeFake(): FakeGateway {
  const result: Record<string, unknown> = {};
  STAGE2_CODES.forEach((code) => {
    result[code] = {
      ohlc: bars(),
      source: 'HARNESS',
      fetchedAt: new Date(STAGE2_BEFORE_MS).toISOString(),
      tradeDate: '2026-08-26',
      complete: true,
      barCount: 25,
    };
  });
  return createFakeGateway({ functions: { 'checkup-sparkline': { result } } });
}

function clearSparklineCaches() {
  sparklineCache.clear();
  sparklinePartialCache.clear();
  sparklineFailCache.clear();
}

function Stage2Body({ fake }: { fake: FakeGateway }) {
  const expected = useExpectedTradeDate();
  useSparklines(STAGE2_CODES, { enabled: true });

  const [snap, setSnap] = useState({ count: 0, last: '' });
  useEffect(() => {
    const sync = () => {
      const calls = fake.calls.invoke;
      const last = calls[calls.length - 1];
      const codes = Array.isArray((last?.body as any)?.codes) ? (last!.body as any).codes : [];
      setSnap((prev) => {
        const next = { count: calls.length, last: [...codes].join(',') };
        return prev.count === next.count && prev.last === next.last ? prev : next;
      });
    };
    sync();
    const id = window.setInterval(sync, 100);
    return () => window.clearInterval(id);
  }, [fake]);

  return (
    <div
      id="stage2-sparkline-harness-root"
      data-testid="stage2-sparkline-harness"
      data-stage2-expected-trade-date={expected.expectedTradeDate}
      data-stage2-calendar-ready={expected.calendarReady ? '1' : '0'}
      data-stage2-invoke-count={String(snap.count)}
      data-stage2-last-codes={snap.last}
      style={{ padding: 16, fontFamily: 'system-ui', fontSize: 14, background: '#F5F3EF', minHeight: '100vh' }}
    >
      <div>expected: {expected.expectedTradeDate || '(none)'}</div>
      <div>calendarReady: {String(expected.calendarReady)}</div>
      <div>invokes: {snap.count}</div>
      <div>lastCodes: {snap.last || '(none)'}</div>
    </div>
  );
}

export default function HoldingsSparklineStage2Harness() {
  const clockRef = useRef<HarnessClock | null>(null);
  const [fake] = useState<FakeGateway>(() => makeFake());
  const [booted, setBooted] = useState(false);

  // setup 必須在任何 production hook 讀時間之前完成 → 用 layout-free 的同步 boot effect，
  // 且以 booted flag 阻擋 child 掛載，確保 child 第一次 render 就看到注入後的時鐘。
  useEffect(() => {
    clearSparklineCaches();
    __resetExpectedStoreForTests();
    __resetSparklineTaskForTests();
    resetMarketHolidaysLoader();
    resetMarketHolidays();
    setMarketHolidays([], 'TW'); // canonical loader-ready seam：已載入且無休市日
    setCheckupGateway(fake);
    clockRef.current = installHarnessClock({ fixedNow: STAGE2_BEFORE_MS });
    setBooted(true);
    return () => {
      setBooted(false);
      clockRef.current?.uninstall();
      clockRef.current = null;
      __resetExpectedStoreForTests();
      __resetSparklineTaskForTests();
      clearSparklineCaches();
      resetMarketHolidaysLoader();
      resetMarketHolidays();
      resetCheckupGateway();
    };
  }, [fake]);

  const advance = (toMs: number) => {
    clockRef.current?.uninstall();
    clockRef.current = installHarnessClock({ fixedNow: toMs });
    // production 恢復點：回前景 → store 以「現在」重算並重排 one-shot timer
    document.dispatchEvent(new Event('visibilitychange'));
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, padding: 8 }}>
        <button type="button" data-testid="stage2-advance-boundary" onClick={() => advance(STAGE2_AFTER_MS)}>
          advance across 14:05
        </button>
        <button type="button" data-testid="stage2-advance-5m" onClick={() => advance(STAGE2_AFTER_MS + 5 * 60_000)}>
          +5m
        </button>
        <button type="button" data-testid="stage2-advance-30m" onClick={() => advance(STAGE2_AFTER_MS + 30 * 60_000)}>
          +30m
        </button>
      </div>
      {booted ? <Stage2Body fake={fake} /> : null}
    </div>
  );
}
