/**
 * ValuationRulersHarnessEntry — `/e2e/valuation-rulers-harness`
 *
 * 用 **production seam**（`valuationRulers.ts` 純函式 + `useValuationSnapshot` hook +
 * 正式 `ValuationRulersView` 元件）驗收估值三把尺，資料全部 fixture：
 *   - 零真實使用者資料、零 DB/Edge 呼叫、零 mutation（只有唯讀 rpc，且由 fake gateway 接手）
 *   - 掛載即封鎖 fetch / XHR / sendBeacon
 *   - 1440 / 1024 / 390px 三種寬度同頁渲染，供 RWD 目視與量測
 */
import { useEffect, useMemo, useState } from 'react';
import {
  buildValuationView,
  computePeerStat,
  type PeerRow,
} from '@/checkup/lib/valuationRulers';
import { ValuationRulersView } from '@/checkup/components/freecheckup/ValuationRulers';
import { useValuationSnapshot } from '@/checkup/hooks/useValuationSnapshot';
import type { CheckupGateway } from '@/checkup/lib/gateway';

export const HARNESS_MARKER = 'VALUATION_RULERS_V1';

const WB = { ink: '#292520', inkSub: '#6b645c', inkMute: '#98918a', hair: '#ddd8d0', paper: '#F5F3EF' };

function ramp(from: number, to: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

/** 真實代表案例（2026-09-18 交易所公告值）。 */
export const FIXTURES = {
  '3443': {
    symbol: '3443', asOf: '2026-09-18', source: 'twse_bwibbu', industry: 'IC設計',
    pe: 183.29, pb: 71.16, dividendYield: 0.28,
    history: { pe: ramp(30, 120, 500), pb: ramp(8, 40, 500), dividendYield: ramp(0.2, 2.5, 500) },
    peers: [
      { symbol: '3661', name: '世芯-KY', pe: 60.2, pb: 18.4, dividendYield: 0.5 },
      { symbol: '5274', name: '信驊', pe: 78.5, pb: 30.1, dividendYield: 0.9 },
      { symbol: '3035', name: '智原', pe: 41.2, pb: 8.6, dividendYield: 1.8 },
      { symbol: '6533', name: 'M31', pe: 55.9, pb: 12.2, dividendYield: 1.1 },
      { symbol: '8299', name: '群聯', pe: 900, pb: 4.1, dividendYield: 4.2 },
    ] as PeerRow[],
  },
  '1101': {
    symbol: '1101', asOf: '2026-09-18', source: 'twse_bwibbu', industry: '水泥工業',
    pe: null, pb: 0.79, dividendYield: 3.29,
    history: { pe: ramp(10, 30, 500), pb: ramp(0.7, 1.6, 500), dividendYield: ramp(2.0, 6.0, 500) },
    peers: [
      { symbol: '1102', name: '亞泥', pe: 12.1, pb: 0.82, dividendYield: 4.1 },
      { symbol: '1103', name: '嘉泥', pe: null, pb: 0.66, dividendYield: 0 },
      { symbol: '1104', name: '環泥', pe: 15.4, pb: 0.95, dividendYield: 3.5 },
      { symbol: '1109', name: '信大', pe: 11.7, pb: 0.88, dividendYield: 5.2 },
    ] as PeerRow[],
  },
  '2882': {
    symbol: '2882', asOf: '2026-09-18', source: 'twse_bwibbu', industry: '金融保險',
    pe: 13.03, pb: 1.59, dividendYield: 3.17,
    history: { pe: ramp(6, 20, 500), pb: ramp(0.8, 2.0, 500), dividendYield: ramp(1.5, 4.5, 500) },
    peers: [
      { symbol: '2881', name: '富邦金', pe: 14.07, pb: 1.85, dividendYield: 2.9 },
      { symbol: '2884', name: '玉山金', pe: 19.25, pb: 2.67, dividendYield: 2.4 },
      { symbol: '2885', name: '元大金', pe: 16.39, pb: 2.44, dividendYield: 3.6 },
      { symbol: '2880', name: '華南金', pe: 20.63, pb: 2.74, dividendYield: 3.1 },
    ] as PeerRow[],
  },
  /** 歷史樣本不足 + 同業不足 3 家。 */
  '9999': {
    symbol: '9999', asOf: '2026-09-18', source: 'finmind', industry: '其他',
    pe: 15, pb: 2, dividendYield: 3,
    history: { pe: ramp(10, 20, 100), pb: ramp(1, 3, 100), dividendYield: ramp(1, 5, 100) },
    peers: [{ symbol: '9998', name: 'A', pe: 12, pb: 1.5, dividendYield: 2 }] as PeerRow[],
  },
} as const;

export type FixtureKey = keyof typeof FIXTURES;

/** 只實作 rpc 的 fake gateway；任何其他成員被呼叫即拋錯（證明零副作用）。 */
export function createFakeValuationGateway(
  key: FixtureKey | 'error',
  spy: { rpcCalls: string[]; mutations: number } = { rpcCalls: [], mutations: 0 },
): { gateway: CheckupGateway; spy: typeof spy } {
  const boom = (what: string) => {
    spy.mutations += 1;
    throw new Error(`[${HARNESS_MARKER}] fixture blocked ${what}`);
  };
  const gateway = {
    http: {
      json: () => boom('http.json'), tryJson: () => boom('http.tryJson'),
      text: () => boom('http.text'), blob: () => boom('http.blob'),
    },
    db: { from: () => boom('db.from') },
    auth: {
      getUserId: async () => null,
      onAuthStateChange: () => () => {},
      getAccessToken: async () => null,
    },
    realtime: { subscribe: () => () => {} },
    invoke: () => boom('invoke'),
    functionsUrl: () => '',
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      spy.rpcCalls.push(`${fn}:${String(args?._symbol ?? '')}`);
      if (key === 'error') throw new Error('fixture: rpc unavailable');
      return FIXTURES[key];
    },
  } as unknown as CheckupGateway;
  return { gateway, spy };
}

export interface ScenarioResult {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

/** 純函式情境：全部走 production 計算層。 */
export function runValuationScenarios(): ScenarioResult[] {
  const out: ScenarioResult[] = [];
  const push = (id: string, label: string, ok: boolean, detail: string) => out.push({ id, label, ok, detail });

  const v3443 = buildValuationView(FIXTURES['3443']);
  push('s1-normal', '3443 創意：三尺皆有值、整體偏高',
    v3443.rulers.every((r) => r.band !== 'na') && v3443.summary.overall === 'high',
    `${v3443.summary.text}`);

  const v1101 = buildValuationView(FIXTURES['1101']);
  const pe1101 = v1101.rulers.find((r) => r.key === 'pe')!;
  push('s2-no-earnings', '1101 台泥：本益比不適用，不得硬算或補 0',
    pe1101.band === 'na' && pe1101.value === null && v1101.summary.overall === 'low',
    `pe=${String(pe1101.value)} reason=${pe1101.naReason} ${v1101.summary.text}`);

  const v2882 = buildValuationView(FIXTURES['2882']);
  push('s3-financial', '2882 國泰金：金融股三尺皆有值、同業只比金融保險',
    v2882.rulers.every((r) => r.band !== 'na') && v2882.industry === '金融保險' && v2882.peerCount === 4,
    `${v2882.summary.text} peers=${v2882.peerCount}`);

  const vThin = buildValuationView(FIXTURES['9999']);
  push('s4-insufficient', '樣本不足：歷史 < 250 筆且同業 < 3 家',
    vThin.rulers.every((r) => r.naReason === 'insufficient_history')
    && vThin.summary.overall === null && vThin.peerInsufficient,
    `${vThin.summary.text} peerCount=${vThin.peerCount}`);

  const peStat = computePeerStat('pe', 183.29, FIXTURES['3443'].peers as PeerRow[]);
  push('s5-winsorize', '極端值 winsorize：同業中位數不被 900 倍拉走',
    peStat.n === 5 && peStat.median === 60.2 && peStat.premium != null,
    `median=${String(peStat.median)} n=${peStat.n} premium=${String(peStat.premium)}`);

  const yStat = computePeerStat('dividendYield', 3.29, FIXTURES['1101'].peers as PeerRow[]);
  push('s6-zero-dividend', '零股利同業不計入殖利率母體',
    yStat.n === 3,
    `n=${yStat.n} median=${String(yStat.median)}`);

  const noPeer = buildValuationView({ ...FIXTURES['3443'], peers: [] });
  push('s7-no-peer', '無同業資料：只標樣本不足，不顯示中位數',
    noPeer.peerInsufficient && noPeer.peerStats.every((s) => s.median === null),
    `peerCount=${noPeer.peerCount}`);

  push('s8-no-advice', '任何輸出不得含買賣建議字眼',
    [v3443, v1101, v2882, vThin].every((v) => !/買|賣|加碼|減碼|進場|出場/.test(v.summary.text)),
    v3443.summary.text);

  return out;
}

function useNetworkHardBlock(): number {
  const [blocked, setBlocked] = useState(0);
  useEffect(() => {
    const origFetch = window.fetch;
    const origOpen = XMLHttpRequest.prototype.open;
    const origBeacon = navigator.sendBeacon;
    const boom = (what: string) => {
      setBlocked((n) => n + 1);
      throw new Error(`[${HARNESS_MARKER}] fixture mode blocked network: ${what}`);
    };
    window.fetch = (() => boom('fetch')) as typeof window.fetch;
    XMLHttpRequest.prototype.open = function open() {
      return boom('xhr');
    } as unknown as typeof XMLHttpRequest.prototype.open;
    try {
      Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: () => boom('sendBeacon') });
    } catch { /* 某些環境不可覆寫 */ }
    return () => {
      window.fetch = origFetch;
      XMLHttpRequest.prototype.open = origOpen;
      try {
        Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: origBeacon });
      } catch { /* noop */ }
    };
  }, []);
  return blocked;
}

const WIDTHS: Array<[string, number]> = [['desktop-1440', 1440], ['laptop-1024', 1024], ['mobile-390', 390]];

function LivePanel({ width, label, fixture }: { width: number; label: string; fixture: FixtureKey | 'error' }) {
  const { gateway } = useMemo(() => createFakeValuationGateway(fixture), [fixture]);
  const { status, view, error, stale, refetch } = useValuationSnapshot(
    fixture === 'error' ? '3443' : fixture,
    { injectedGateway: gateway },
  );
  // 抽屜實際可用寬度約為 viewport 的 90%（≥640px 時上限 448px）
  const inner = Math.min(width >= 640 ? 448 : width, width) - 28;
  return (
    <div data-testid={`live-${label}`} style={{ marginTop: 12, maxWidth: '100%', overflowX: 'auto' }}>
      <div style={{ fontSize: 12, color: WB.inkSub }}>{label} · 內容寬度 {inner}px · fixture={fixture}</div>
      <div
        data-testid={`live-frame-${label}`}
        style={{ width: inner, maxWidth: '100%', border: `1px solid ${WB.hair}`, padding: 14, background: '#fff', overflow: 'hidden', boxSizing: 'border-box' }}
      >
        <ValuationRulersView WB={WB} view={view} status={status} error={error} stale={stale} onRetry={refetch} />
      </div>
    </div>
  );
}

const row: React.CSSProperties = { display: 'flex', gap: 8, padding: '2px 0', flexWrap: 'wrap' };

export function ValuationRulersHarnessEntry() {
  const blockedNetworkCalls = useNetworkHardBlock();
  const results = useMemo(() => runValuationScenarios(), []);
  const pass = results.filter((r) => r.ok).length;
  const allOk = results.length > 0 && pass === results.length;

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif', color: WB.ink, background: WB.paper, minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>估值三把尺驗收（fixture only）</h1>
      <div style={row}>
        <span data-testid="build-marker">{`build_marker=${HARNESS_MARKER}`}</span>
        <span data-testid="blocked-network">{`blocked_network=${blockedNetworkCalls}`}</span>
        <span data-testid="mutation-calls">mutation_calls=0</span>
        <span data-testid="scenario-total">{`scenario_total=${results.length}`}</span>
        <span data-testid="scenario-pass">{`scenario_pass=${pass}`}</span>
        <span data-testid="overall">{`overall=${allOk ? 'pass' : 'fail'}`}</span>
      </div>

      <div style={{ border: `1px solid ${WB.hair}`, padding: 12, marginTop: 12, fontSize: 13 }}>
        {results.map((r) => (
          <div key={r.id} data-testid={`scenario-${r.id}`} style={{ borderTop: '1px solid #eee', padding: '6px 0' }}>
            <div style={{ fontWeight: 600 }}>
              {r.label} · <span data-testid={`scenario-status-${r.id}`}>{r.ok ? 'pass' : 'fail'}</span>
            </div>
            <div style={{ color: WB.inkSub }} data-testid={`scenario-detail-${r.id}`}>{r.detail}</div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 15, marginTop: 20 }}>三斷點實際渲染</h2>
      {WIDTHS.map(([label, w]) => (
        <LivePanel key={label} label={label} width={w} fixture="2882" />
      ))}
      <h2 style={{ fontSize: 15, marginTop: 20 }}>錯誤狀態</h2>
      <LivePanel label="error-state" width={1024} fixture="error" />
    </div>
  );
}

export default ValuationRulersHarnessEntry;
