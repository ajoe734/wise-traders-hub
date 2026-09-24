/**
 * 持倉報價自動刷新：各設定實際請求數、收盤待補退避、過期回應保護（2026-09-24）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { decideAutoRefresh, recordCloseAttempt, type CloseBackoffState } from '@/checkup/lib/autoRefreshGate';
import { createQuoteRequestGate, mergeQuoteIntoHolding } from '@/checkup/lib/quoteRequestGate';

const calc = (h: any, price: number) => {
  const value = price * h.qty;
  const cost = h.cost * h.qty;
  return { value, pnl: value - cost, pct: cost > 0 ? ((value - cost) / cost) * 100 : 0 };
};

/**
 * 以 fake timers 重現 FreeCheckup 的 timer 鏈：進頁立即跑一次，之後每 interval 觸發 gate；
 * 請求耗時 latencyMs，完成時寫 lastUpdate。回傳 (0, horizon] 內的請求時間點。
 */
function simulate(minutes: number, horizonMs: number, opts: { latencyMs?: number; closePending?: (n: number) => boolean; settledOk?: boolean } = {}) {
  const latency = opts.latencyMs ?? 3000;
  const t0 = Date.now();
  const runs: number[] = [];
  const st = { lastUpdateMs: null as number | null, lastRunAt: 0 };
  const bo: CloseBackoffState = { fp: null, attempts: 0, nextAt: 0 };
  const attempt = () => {
    const now = Date.now();
    const closePending = opts.closePending ? opts.closePending(now - t0) : false;
    const d = decideAutoRefresh({ now, minutes, lastUpdateMs: st.lastUpdateMs, lastRunAt: st.lastRunAt, closePending, authorityDone: false, fingerprint: '2026-09-23|2330', backoff: bo });
    if (!d.run) return;
    st.lastRunAt = now;
    runs.push(now - t0);
    setTimeout(() => { st.lastUpdateMs = Date.now(); recordCloseAttempt(bo, Date.now(), !!opts.settledOk, closePending); }, latency);
  };
  attempt();
  if (minutes > 0) {
    const tick = () => { setTimeout(() => { attempt(); tick(); }, minutes * 60_000); };
    tick();
  }
  vi.advanceTimersByTime(horizonMs);
  return runs;
}

describe('自動刷新各設定實際請求數（含 t=0 進頁那次）', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-24T02:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  // 關閉＝0 次（進頁也不自動取價）。其餘 30 分鐘視窗 [0, 30min]：進頁 1 次 + floor(30/m) 次週期；timer 在第 30 分鐘整點也觸發一次。
  const cases: Array<[number, number]> = [[0, 0], [1, 31], [3, 11], [5, 7], [10, 4], [30, 2]];
  for (const [m, expected] of cases) {
    it(`設定 ${m === 0 ? '關閉' : m + ' 分鐘'} → 30 分鐘內 ${expected} 次`, () => {
      const runs = simulate(m, 30 * 60_000);
      expect(runs.length).toBe(expected);
    });
  }

  it('舊版無寬限會隔輪跳過（回歸鎖）：請求 3 秒完成時 5 分鐘仍每 5 分鐘一次', () => {
    const runs = simulate(5, 30 * 60_000, { latencyMs: 8000 });
    expect(runs).toEqual([0, 5, 10, 15, 20, 25, 30].map((m) => m * 60_000));
  });

  it('量測口徑說明：只看 (5, 30] 分鐘區間時 5 分鐘設定是 5 次（10/15/20/25/30）', () => {
    const runs = simulate(5, 30 * 60_000).filter((t) => t > 5 * 60_000);
    expect(runs.length).toBe(5);
  });
});

describe('pending_close 退避', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-24T10:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('同日收盤待補且關閉週期：退避 1→2→5→15→30 分鐘，不熱迴圈', () => {
    const bo: CloseBackoffState = { fp: null, attempts: 0, nextAt: 0 };
    const t0 = Date.now();
    const runs: number[] = [];
    let lastRunAt = 0;
    // 每 10 秒嘗試一次（模擬 holdings 變動觸發），60 分鐘
    for (let t = 0; t <= 60 * 60_000; t += 10_000) {
      vi.setSystemTime(t0 + t);
      const d = decideAutoRefresh({ now: t0 + t, minutes: 60, lastUpdateMs: t0 + t, lastRunAt, closePending: true, authorityDone: false, fingerprint: 'fp', backoff: bo });
      if (d.run) { lastRunAt = t0 + t; runs.push(t / 60_000); recordCloseAttempt(bo, t0 + t, false, true); }
    }
    // 第一次在 55 秒最小間隔後才可能（lastRunAt=0 → 立即），之後依退避
    expect(runs).toEqual([0, 1, 3, 8, 23, 53]);
  });

  it('交易日改變（fingerprint 改變）會重置退避', () => {
    const bo: CloseBackoffState = { fp: 'old', attempts: 4, nextAt: Date.now() + 30 * 60_000 };
    const d = decideAutoRefresh({ now: Date.now(), minutes: 60, lastUpdateMs: Date.now(), lastRunAt: 0, closePending: true, authorityDone: false, fingerprint: 'new', backoff: bo });
    expect(d.run).toBe(true);
    expect(bo.attempts).toBe(0);
  });

  it('手動刷新重置退避（FreeCheckup 以 manual:true 把 backoff 歸零）後立即可跑', () => {
    let bo: CloseBackoffState = { fp: 'fp', attempts: 3, nextAt: Date.now() + 15 * 60_000 };
    expect(decideAutoRefresh({ now: Date.now(), minutes: 60, lastUpdateMs: Date.now(), lastRunAt: 0, closePending: true, authorityDone: false, fingerprint: 'fp', backoff: bo }).run).toBe(false);
    bo = { fp: null, attempts: 0, nextAt: 0 };
    expect(decideAutoRefresh({ now: Date.now(), minutes: 60, lastUpdateMs: Date.now(), lastRunAt: 0, closePending: true, authorityDone: false, fingerprint: 'fp', backoff: bo }).run).toBe(true);
  });

  it('定版成功後退避歸零', () => {
    const bo: CloseBackoffState = { fp: 'fp', attempts: 3, nextAt: 999 };
    recordCloseAttempt(bo, 0, true, true);
    expect(bo).toEqual({ fp: 'fp', attempts: 0, nextAt: 0 });
  });
});

describe('報價請求過期保護', () => {
  it('慢回應晚到：舊 ticket 不是 current，不得寫入', () => {
    const gate = createQuoteRequestGate();
    const a = gate.begin(1);
    const b = gate.begin(2);
    expect(a.signal?.aborted).toBe(true);
    expect(gate.isCurrent(a)).toBe(false);
    expect(gate.isCurrent(b)).toBe(true);
  });

  it('請求期間使用者改了股數／成本／名稱：合併只覆寫價格欄位', () => {
    const atRequest = { code: '2330', name: '台積電', qty: 1000, cost: 500, price: 900, priceUpdatedAt: '2026-09-24T01:00:00Z' };
    const edited = { ...atRequest, qty: 2000, cost: 480, name: '台積電（長抱）' };
    const merged = mergeQuoteIntoHolding(edited, { price: 1000, source: 'db', updatedAt: '2026-09-24T01:05:00Z', state: 'live' }, calc, '2026-09-24T01:05:00Z');
    expect(merged.qty).toBe(2000);
    expect(merged.cost).toBe(480);
    expect(merged.name).toBe('台積電（長抱）');
    expect(merged.price).toBe(1000);
    expect(merged.value).toBe(2_000_000);
  });

  it('回應比現有報價還舊（realtime 已推新價）→ 不倒退、回傳原物件', () => {
    const h = { code: '2330', qty: 1, cost: 1, price: 1010, priceUpdatedAt: '2026-09-24T01:06:00Z' };
    expect(mergeQuoteIntoHolding(h, { price: 1000, source: 'db', updatedAt: '2026-09-24T01:05:00Z' }, calc, 'x')).toBe(h);
  });

  it('價格欄位完全相同 → 回傳原物件（不換參考）', () => {
    const h: any = { code: '2330', qty: 1, cost: 1 };
    const once = mergeQuoteIntoHolding(h, { price: 10, source: 'db', updatedAt: '2026-09-24T01:00:00Z', state: 'live', reason: 'x' }, calc, 'n');
    const twice = mergeQuoteIntoHolding(once, { price: 10, source: 'db', updatedAt: '2026-09-24T01:00:00Z', state: 'live', reason: 'x' }, calc, 'n');
    expect(twice).toBe(once);
  });
});
