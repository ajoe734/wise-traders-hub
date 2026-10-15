import { describe, it, expect } from 'vitest';
import { findPeerGroup, pickMainRuler, buildStations, buildPeerReference, buildForwardReference, selfForwardEps, positionQuantile, stationPosition } from '@/checkup/lib/valuationStations';

describe('主尺選擇', () => {
  it('金融股用 PB', () => expect(pickMainRuler({ industry: '銀行', ttmEps: 3, currentPe: 12, revenueYoY: 0.5 }).key).toBe('pb'));
  it('近四季虧損且營收年增 >20% 用 PS', () => expect(pickMainRuler({ industry: '半導體', ttmEps: -1, currentPe: null, revenueYoY: 0.21 }).key).toBe('ps'));
  it('近四季虧損且營收年增 ≤20% 用 PB', () => expect(pickMainRuler({ industry: '半導體', ttmEps: -1, currentPe: null, revenueYoY: 0.2 }).key).toBe('pb'));
  it('本益比超過 60 倍不用 PE', () => expect(pickMainRuler({ industry: '電子', ttmEps: 1, currentPe: 61, revenueYoY: 0.3 }).key).toBe('ps'));
  it('本益比 60 倍整仍用 PE', () => expect(pickMainRuler({ industry: '電子', ttmEps: 1, currentPe: 60, revenueYoY: 0.3 }).key).toBe('pe'));
  it('門檻可調整', () => expect(pickMainRuler({ industry: '電子', ttmEps: 1, currentPe: 45, revenueYoY: 0.3 }, { peCap: 40, psGrowth: 0.2 }).key).toBe('ps'));
});

describe('站牌', () => {
  const year = Array.from({ length: 241 }, (_, i) => i + 1); // 1..241，取最後 240 天 = 2..241
  it('取近 240 日第 20/50/80% 倍數 × 基本面', () => {
    const r = buildStations('pe', year, 10);
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect(r.days).toBe(240);
    expect(r.stations.map((s) => +s.multiple.toFixed(2))).toEqual([49.8, 121.5, 193.2]);
    expect(r.stations[0].price).toBeCloseTo(498);
    expect(r.stations.map((s) => s.label)).toEqual(['上車站', '下車安全帶', '高壓站']);
  });
  it('資料不滿一年顯示資料不足', () => expect(buildStations('pe', year.slice(0, 239), 10).status).toBe('insufficient'));
  it('虧損（EPS ≤ 0）PE 不適用', () => {
    const r = buildStations('pe', year, -2);
    expect(r.status === 'insufficient' && r.reason).toContain('PE 不適用');
  });
  it('緯創範例：12.59 × 14.73／16.65／18.91 ≈ 185／210／238', () => {
    expect(Math.round(12.59 * 14.73)).toBe(185);
    expect(Math.round(12.59 * 16.65)).toBe(210);
    expect(Math.round(12.59 * 18.91)).toBe(238);
  });
});

describe('同業參考', () => {
  const peers = [{ symbol: '2382', pe: 15 }, { symbol: '2356', pe: 14 }, { symbol: '2317', pe: 16 }, { symbol: '9999', pe: 99 }];
  it('人工名單當日倍數平均 × 基本面，排除名單外', () => {
    const r = buildPeerReference('3231', 'pe', 10, peers, findPeerGroup('3231'));
    expect(r.status === 'ready' && r.avgMultiple).toBe(15);
    expect(r.status === 'ready' && r.price).toBe(150);
  });
  it('同業不足 3 家顯示資料不足', () => expect(buildPeerReference('3231', 'pe', 10, peers.slice(0, 2), findPeerGroup('3231')).status).toBe('insufficient'));
  it('無人工名單顯示資料不足', () => expect(buildPeerReference('9998', 'pe', 10, peers, findPeerGroup('9998', '不存在產業')).status).toBe('insufficient'));
});

const year = Array.from({ length: 240 }, (_, i) => 10 + (i % 24) * 0.5);
const sortedYear = [...year].sort((a, b) => a - b);
describe('前瞻參考', () => {
  it('緯創範例 17.94 × 15 ≈ 269，壓力測試 ≈ 215，現價隱含 ≈ 10.2 倍', () => {
    const r = buildForwardReference({ eps: 17.94, multiple: 15, period: '2026H2–2027H1', source: '美銀同期間' }, 183);
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect(Math.round(r.price)).toBe(269);
    expect(Math.round(r.stress)).toBe(215);
    expect(r.impliedMultiple!.toFixed(1)).toBe('10.2');
  });
  it('無任何前瞻 EPS 顯示資料不足', () => expect(buildForwardReference(null, 183, year, null).status).toBe('insufficient'));
  it('券商倍數優先於歷史倍數', () => {
    const r = buildForwardReference({ eps: 17.94, multiple: 15, period: '未來四季', source: '美銀' }, 183, year, selfForwardEps(12.59, { yoy: 0.3, latestMonth: '2026-09' }));
    expect(r).toMatchObject({ status: 'ready', mode: 'broker' });
  });
  it('新聞 EPS（無倍數）× 近一年 PE P20/P50/P80，壓力測試八折', () => {
    const r = buildForwardReference({ eps: 20, multiple: null, period: '未來四季', source: null, epsSource: '經濟日報' }, 183, year, null);
    expect(r.status).toBe('ready');
    if (r.status !== 'ready' || r.mode !== 'historical') throw new Error('mode');
    expect(r.epsKind).toBe('news');
    expect(r.multiples.p50).toBe(positionQuantile(sortedYear, 0.5));
    expect(r.price).toBeCloseTo(20 * r.multiples.p50);
    expect(r.low).toBeCloseTo(20 * r.multiples.p20);
    expect(r.high).toBeCloseTo(20 * r.multiples.p80);
    expect(r.stress).toBeCloseTo(20 * 0.8 * r.multiples.p50);
  });
  it('新聞 EPS 優先於月營收自建', () => {
    const r = buildForwardReference({ eps: 20, multiple: null, period: '未來四季', source: null, epsSource: '經濟日報' }, 183, year, selfForwardEps(10, { yoy: 0.1, latestMonth: '2026-09' }));
    expect(r.status === 'ready' && r.mode === 'historical' && r.eps).toBe(20);
  });
  it('沒有新聞 EPS 時用月營收自建：12.59 × 1.3', () => {
    const r = buildForwardReference(null, 183, year, selfForwardEps(12.59, { yoy: 0.3, latestMonth: '2026-09' }));
    expect(r.status === 'ready' && r.mode === 'historical' && r.epsKind).toBe('self');
    expect(r.status === 'ready' && r.mode === 'historical' && r.eps).toBeCloseTo(16.367);
  });
  it('虧損或缺月營收不自建', () => {
    expect(selfForwardEps(-1, { yoy: 0.3, latestMonth: '2026-09' })).toBeNull();
    expect(selfForwardEps(12.59, null)).toBeNull();
  });
  it('近一年 PE 不滿 240 日 → 資料不足，不硬補', () => {
    expect(buildForwardReference(null, 183, year.slice(0, 100), selfForwardEps(12.59, { yoy: 0.3, latestMonth: '2026-09' })).status).toBe('insufficient');
  });
});

it('現價 183 在上車站 185 附近', () => {
  const st = { status: 'ready' as const, key: 'pe' as const, basis: 12.59, days: 240, stations: [
    { key: 'board' as const, label: '上車站', multiple: 14.73, price: 185.4 },
    { key: 'belt' as const, label: '下車安全帶', multiple: 16.65, price: 209.6 },
    { key: 'pressure' as const, label: '高壓站', multiple: 18.91, price: 238.1 }] };
  expect(stationPosition(183, st)).toBe('在上車站附近');
});

describe('同業名單查找', () => {
  it('名單內直接對應：3231 對應 ODM／伺服器', () => expect(findPeerGroup('3231')?.label).toBe('ODM／伺服器'));
  it('不在名單內時，依主分類名稱對應', () => expect(findPeerGroup('9997', '晶圓代工')?.label).toBe('晶圓代工'));
  it('主分類無對應名單時回傳 null', () => expect(findPeerGroup('9997', '不存在產業')).toBeNull());
});
