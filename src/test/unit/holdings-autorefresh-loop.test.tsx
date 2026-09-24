/**
 * 真實 startAutoRefreshLoop（FreeCheckup 同一支）+ 真實 HoldingsHero：
 *  - off/1/3/5/10/30 分鐘在 30 分鐘內的實際請求數
 *  - 「下次刷新」與 setTimeout 觸發時刻同源
 *  - 分頁隱藏跳過、focus/visibility/online 不觸發額外整批請求
 *  - Hero 30 秒相對時間 tick 不讓父層與持倉卡片重畫、不重跑資料查詢
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { memo, useEffect, useRef } from 'react';
import {
  startAutoRefreshLoop, getNextAutoRefreshAt, setAutoRefreshMinutes,
} from '@/checkup/lib/autoRefreshInterval';
import { decideAutoRefresh, type CloseBackoffState } from '@/checkup/lib/autoRefreshGate';
import HoldingsHero from '@/checkup/components/freecheckup/HoldingsHero';
import { WB, wbTone } from '@/pages/_freeCheckup/constants.jsx';

const T0 = new Date('2026-09-24T02:00:00Z').getTime();

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

/** 進頁那次（t=0）+ loop 以 gate 決策發請求；請求 3 秒完成。 */
async function runFor(minutes: number, horizonMs: number, hidden = () => false) {
  const st = { lastUpdateMs: null as number | null, lastRunAt: 0 };
  const bo: CloseBackoffState = { fp: null, attempts: 0, nextAt: 0 };
  const requests: number[] = [];
  const fire = () => {
    const now = Date.now();
    const d = decideAutoRefresh({ now, minutes, lastUpdateMs: st.lastUpdateMs, lastRunAt: st.lastRunAt, closePending: false, authorityDone: false, fingerprint: 'fp', backoff: bo });
    if (!d.run) return;
    st.lastRunAt = now;
    requests.push(now - T0);
    setTimeout(() => { st.lastUpdateMs = Date.now(); }, 3000);
  };
  // 進頁初始載入：不經 gate（關閉自動也會載一次）
  st.lastRunAt = Date.now(); requests.push(0); setTimeout(() => { st.lastUpdateMs = Date.now(); }, 3000);
  const nextAts: number[] = [];
  const firedAt: number[] = [];
  const dispose = startAutoRefreshLoop({
    getMinutes: () => minutes,
    run: () => { firedAt.push(Date.now()); fire(); },
    isHidden: hidden,
  });
  const recordNext = () => { const n = getNextAutoRefreshAt(); if (n) nextAts.push(n); };
  recordNext();
  const step = 1000;
  for (let t = 0; t < horizonMs; t += step) {
    await act(async () => { vi.advanceTimersByTime(step); });
    const n = getNextAutoRefreshAt();
    if (n && n !== nextAts[nextAts.length - 1]) nextAts.push(n);
  }
  dispose();
  return { requests, nextAts, firedAt };
}

describe('startAutoRefreshLoop 各設定 30 分鐘請求數', () => {
  const cases: [number, number][] = [[0, 1], [1, 31], [3, 11], [5, 7], [10, 4], [30, 2]];
  for (const [m, expected] of cases) {
    it(`${m === 0 ? '關閉' : m + ' 分鐘'} → [0,30min] 共 ${expected} 次（含 t=0 與 t=30min 邊界）`, async () => {
      const { requests } = await runFor(m, 30 * 60_000);
      expect(requests.length).toBe(expected);
      if (m > 0) expect(requests[requests.length - 1]).toBe(30 * 60_000);
    });
  }

  it('下次刷新時間 = 實際觸發時間（同一計時來源）', async () => {
    const { nextAts, firedAt } = await runFor(5, 30 * 60_000);
    expect(firedAt.length).toBe(6);
    firedAt.forEach((t, i) => expect(t).toBe(nextAts[i]));
  });

  it('關閉時下次刷新為 null，不排任何 timer', () => {
    const dispose = startAutoRefreshLoop({ getMinutes: () => 0, run: vi.fn() });
    expect(getNextAutoRefreshAt()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    dispose();
  });

  it('分頁隱藏期間不發請求，但繼續排下一輪', async () => {
    let hidden = true;
    const { requests } = await runFor(5, 30 * 60_000, () => hidden);
    expect(requests).toEqual([0]); // 只有進頁那次
    hidden = false;
  });

  it('focus / visibilitychange / online 事件不觸發 loop 額外請求，也不重設計時', async () => {
    const run = vi.fn();
    const dispose = startAutoRefreshLoop({ getMinutes: () => 5, run, isHidden: () => false });
    const before = getNextAutoRefreshAt();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('online'));
    });
    expect(run).toHaveBeenCalledTimes(0);
    expect(getNextAutoRefreshAt()).toBe(before);
    await act(async () => { vi.advanceTimersByTime(4 * 60_000); });
    expect(run).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('改設定立即重排：5 分鐘改 1 分鐘，下次時間改為 now+1min', async () => {
    const run = vi.fn();
    const dispose = startAutoRefreshLoop({ getMinutes: () => Number(localStorage.getItem('fc.holdings.autoRefreshMinutes') ?? 5), run, isHidden: () => false });
    await act(async () => { vi.advanceTimersByTime(10_000); setAutoRefreshMinutes(1); });
    expect(getNextAutoRefreshAt()).toBe(Date.now() + 60_000);
    dispose();
    expect(getNextAutoRefreshAt()).toBeNull();
  });
});

describe('Hero 30 秒 tick 隔離', () => {
  it('閒置 10 分鐘：父層與卡片不重畫、資料查詢不重跑，只有 Hero 相對時間前進', async () => {
    const counts = { parent: 0, card: 0, query: 0 };
    const Card = memo(function Card() {
      counts.card += 1;
      useEffect(() => { counts.query += 1; }, []);
      return <div>card</div>;
    });
    const lastUpdate = new Date(T0);
    const holdings = [{ code: '2330', price: 1000, priceSource: 'close', priceUpdatedAt: new Date(T0).toISOString() }];
    const noop = () => {};
    function Parent() {
      counts.parent += 1;
      const stable = useRef({ holdings, lastUpdate }).current;
      return (
        <>
          <HoldingsHero
            totalVal={100000} totalCost={90000} holdingsCount={1} winnersCount={1}
            exitListLength={0} reviewListLength={0} maxHoldings={20} rtConnected={false}
            lastUpdate={stable.lastUpdate} refreshing={false} onRefreshPrices={noop}
            isDemo={false} WB={WB} wbTone={wbTone} holdings={stable.holdings}
          />
          <Card />
        </>
      );
    }
    render(<Parent />);
    const p0 = counts.parent, c0 = counts.card, q0 = counts.query;
    const textAt = () => document.body.textContent || '';
    const before = textAt();
    for (let i = 0; i < 20; i++) await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(counts.parent).toBe(p0);
    expect(counts.card).toBe(c0);
    expect(counts.query).toBe(q0);
    expect(textAt()).not.toBe(before); // Hero 內「N 分鐘前」有前進
    expect(screen.getByTestId('holdings-hero-next-refresh')).toBeTruthy();
  });
});
