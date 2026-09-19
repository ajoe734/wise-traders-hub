/**
 * SignalArithmeticHarnessEntry — `/e2e/signal-arithmetic-harness`
 *
 * 目的：在 hosted Preview 用 **production seam** 驗收週記算數：
 *   - `applySignalMathVector`（src/lib/signalTradeLogic.ts）＝ canonical calculator
 *   - `computeCashSim`（src/pages/_signalEditor/derive.ts）＝ 撰寫頁實際用的現金模擬
 *   - `src/lib/signalMath.contract.json` = 唯一期望值來源（SIGNAL_MATH_CONTRACT_V1）
 *
 * 憲法：
 *   - 不在本檔複製任何公式，只餵 fixture 給 production 函式。
 *   - fixture mode 掛載即封鎖 fetch / XHR / sendBeacon。
 *   - 零真實使用者資料、零 DB/Edge 呼叫、零 mutation。
 */
import { useEffect, useMemo, useState } from 'react';
import contract from '@/lib/signalMath.contract.json';
import { applySignalMathVector, type SignalMathResult } from '@/lib/signalTradeLogic';
import { computeCashSim } from '@/pages/_signalEditor/derive';
import type { CapitalStatus, OpenPosition, TradeDraft } from '@/pages/_signalEditor/types';

export const HARNESS_MARKER = 'SIGNAL_ARITHMETIC_V1';

interface ContractVector {
  id: string;
  note: string;
  action: string;
  price: number;
  quantity: number;
  unit: string;
  priorQtyShares: number;
  priorAvg: number;
  expected: Record<string, number>;
}

const VECTORS = (contract as { version: string; vectors: ContractVector[] }).vectors;
const CONTRACT_VERSION = (contract as { version: string }).version;

/** expected key → production result key（effectiveSellShares 是 vector 的別名） */
const KEY_MAP: Record<string, keyof SignalMathResult> = {
  shares: 'shares',
  effectiveSellShares: 'effectiveShares',
  cashDelta: 'cashDelta',
  newQty: 'newQty',
  newAvg: 'newAvg',
  positionCost: 'positionCost',
  realizedPnl: 'realizedPnl',
  pnlPercent: 'pnlPercent',
};

function evaluate(v: ContractVector) {
  const actual = applySignalMathVector(v);
  const fields = Object.entries(v.expected).map(([k, want]) => {
    const got = actual[KEY_MAP[k]] as number | undefined;
    return { key: k, want, got: got ?? null, ok: Number(got) === Number(want) };
  });
  return { actual, fields, ok: fields.every((f) => f.ok) };
}

// ---------------------------------------------------------------------------
// production 反例：直接餵 SignalEditor 的 TradeDraft/CapitalStatus 給 computeCashSim
// ---------------------------------------------------------------------------

const emptyDraft = (over: Partial<TradeDraft>): TradeDraft => ({
  uid: Math.random().toString(36).slice(2, 8),
  executedAt: '2026-09-15T10:00',
  stockCode: '',
  stockName: '',
  action: '',
  priceHint: '',
  quantity: '',
  quantityUnit: '張',
  reasonSummary: '',
  reasonDetail: '',
  riskNotes: '',
  ...over,
});

const position = (symbol: string, qty: number, avg: number): OpenPosition => ({
  symbol,
  instrument: symbol,
  quantity_shares: qty,
  quantity_unit: '股',
  entry_price: avg,
  current_price: avg,
  market_value: qty * avg,
  cost_value: qty * avg,
  unrealized_pnl: 0,
  unrealized_pct: 0,
});

const capital = (cash: number, positions: OpenPosition[]): CapitalStatus => ({
  starting_capital: cash,
  realized_pnl_amount: 0,
  open_cost_value: positions.reduce((s, p) => s + (p.cost_value || 0), 0),
  open_market_value: positions.reduce((s, p) => s + p.market_value, 0),
  unrealized_pnl_amount: 0,
  available_cash: cash,
  open_positions: positions,
  recent_trades: [],
  currency: 'TWD',
  asset_class: 'tw_stock',
});

interface CaseDef {
  id: string;
  label: string;
  trades: TradeDraft[];
  capital: CapitalStatus;
  /** 依 SIGNAL_MATH_CONTRACT_V1 的正確剩餘現金 */
  expectedRemaining: number;
  /** 修正前（舊口徑）會算出的錯誤值，僅供對照顯示 */
  legacyRemaining: number;
}

const CASES: CaseDef[] = [
  {
    id: 'c1-00708L-lot-unit',
    label: '反例 1：00708L 買 2 張 @77.7（張→股只換算一次）',
    trades: [emptyDraft({
      stockCode: '00708L', stockName: '期元大S&P黃金正2',
      action: 'buy', priceHint: '77.7', quantity: '2', quantityUnit: '張',
    })],
    capital: capital(1_000_000, []),
    expectedRemaining: 1_000_000 - 155_400,
    legacyRemaining: 1_000_000 - 155_400_000,
  },
  {
    id: 'c2-6706-exit-uses-exit-price',
    label: '反例 2：6706 持有 1000 股 @123，@143 平倉（用出場價回收）',
    trades: [emptyDraft({
      stockCode: '6706', stockName: '惠特',
      action: 'exit', priceHint: '143', quantity: '1', quantityUnit: '張',
    })],
    capital: capital(500_000, [position('6706', 1000, 123)]),
    expectedRemaining: 500_000 + 143_000,
    legacyRemaining: 500_000 + 123_000,
  },
  {
    id: 'c3-3006-orphan-realized',
    label: '反例 3：3006 持有 1000 股 @174，@238 賣出（已實現 +64,000）',
    trades: [emptyDraft({
      stockCode: '3006', stockName: '晶豪科',
      action: 'sell', priceHint: '238', quantity: '1', quantityUnit: '張',
    })],
    capital: capital(200_000, [position('3006', 1000, 174)]),
    expectedRemaining: 200_000 + 238_000,
    legacyRemaining: 200_000 + 174_000,
  },
];

/** fixture mode：封鎖所有真實網路出口。 */
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
    } catch {
      /* 某些環境不可覆寫 */
    }
    return () => {
      window.fetch = origFetch;
      XMLHttpRequest.prototype.open = origOpen;
      try {
        Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: origBeacon });
      } catch {
        /* noop */
      }
    };
  }, []);
  return blocked;
}

const box: React.CSSProperties = { border: '1px solid #ddd8d0', padding: 12, marginTop: 12, fontSize: 13 };
const row: React.CSSProperties = { display: 'flex', gap: 8, padding: '2px 0', flexWrap: 'wrap' };

export function SignalArithmeticHarnessEntry() {
  const blockedNetworkCalls = useNetworkHardBlock();

  const vectorResults = useMemo(() => VECTORS.map((v) => ({ v, r: evaluate(v) })), []);
  const vectorPass = vectorResults.filter((x) => x.r.ok).length;

  const caseResults = useMemo(
    () => CASES.map((c) => {
      const sim = computeCashSim(c.trades, c.capital);
      return { c, remaining: Math.round(sim.remaining * 100) / 100, ok: Math.round(sim.remaining * 100) / 100 === c.expectedRemaining };
    }),
    [],
  );
  const casePass = caseResults.filter((x) => x.ok).length;

  const allOk = vectorPass === VECTORS.length && casePass === CASES.length;

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif', color: '#292520', background: '#F5F3EF', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>週記算數驗收（fixture only）</h1>
      <div style={row}>
        <span data-testid="build-marker">{`build_marker=${HARNESS_MARKER}`}</span>
        <span data-testid="contract-version">{`contract_version=${CONTRACT_VERSION}`}</span>
        <span data-testid="blocked-network">{`blocked_network=${blockedNetworkCalls}`}</span>
        <span data-testid="mutation-calls">mutation_calls=0</span>
        <span data-testid="overall">{`overall=${allOk ? 'pass' : 'fail'}`}</span>
      </div>

      <div style={box}>
        <strong>1. Contract vectors（applySignalMathVector）</strong>
        <div style={row}>
          <span data-testid="vector-total">{`vector_total=${VECTORS.length}`}</span>
          <span data-testid="vector-pass">{`vector_pass=${vectorPass}`}</span>
          <span data-testid="vector-fail">{`vector_fail=${VECTORS.length - vectorPass}`}</span>
        </div>
        {vectorResults.map(({ v, r }) => (
          <div key={v.id} data-testid={`vector-${v.id}`} style={{ borderTop: '1px solid #eee', padding: '6px 0' }}>
            <div style={{ fontWeight: 600 }}>
              {v.id} · <span data-testid={`vector-status-${v.id}`}>{r.ok ? 'pass' : 'fail'}</span>
            </div>
            <div style={{ color: '#6b645c' }}>{v.note}</div>
            <div style={row}>
              {r.fields.map((f) => (
                <span key={f.key} data-testid={`vector-${v.id}-${f.key}`}>
                  {`${f.key}: want=${f.want} got=${f.got}`}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={box}>
        <strong>2. 正式反例（computeCashSim，SignalEditor production path）</strong>
        <div style={row}>
          <span data-testid="case-total">{`case_total=${CASES.length}`}</span>
          <span data-testid="case-pass">{`case_pass=${casePass}`}</span>
        </div>
        {caseResults.map(({ c, remaining, ok }) => (
          <div key={c.id} data-testid={`case-${c.id}`} style={{ borderTop: '1px solid #eee', padding: '6px 0' }}>
            <div style={{ fontWeight: 600 }}>
              {c.label} · <span data-testid={`case-status-${c.id}`}>{ok ? 'pass' : 'fail'}</span>
            </div>
            <div style={row}>
              <span data-testid={`case-${c.id}-remaining`}>{`remaining=${remaining}`}</span>
              <span data-testid={`case-${c.id}-expected`}>{`expected=${c.expectedRemaining}`}</span>
              <span data-testid={`case-${c.id}-legacy`}>{`legacy_wrong=${c.legacyRemaining}`}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default SignalArithmeticHarnessEntry;
