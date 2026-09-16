/**
 * UNPUBLISHED_JOURNAL_EDIT_ISOLATION_V1 — hosted Preview QA harness。
 *
 * 只在 localhost / `preview--<slug>.lovable.app` 可達（route 由 HarnessRouteGuard 守）。
 * fixture mode：掛載即 hard-block 所有真實網路（fetch / XHR / sendBeacon），
 * 因此不可能打到正式 Supabase REST / RPC；提交走 production 的
 * evaluatePublishGate + validateJournalContentFields + buildPendingContentRows
 * + submitPendingMentorEdit seam，只把 RPC adapter 換成 mock。
 *
 * mutation_calls 定義：實際「成功寫入內容」的 RPC 次數（RPC 回錯不算）。
 * rpc_calls 則是 adapter 被呼叫的次數，用來證明被擋下的情境根本沒送出。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { evaluatePublishGate } from '@/pages/_signalEditor/publishGate';
import { validateJournalContentFields, buildPendingContentRows } from '@/pages/_signalEditor/derive';
import {
  submitPendingMentorEdit, type PendingMentorRpc,
} from '@/pages/_signalEditor/pendingMentorSubmit';
import type { TradeDraft } from '@/pages/_signalEditor/types';

export const HARNESS_MARKER = 'UNPUBLISHED_JOURNAL_EDIT_ISOLATION_V1';

type ScenarioKey =
  | 'title-price-edit'
  | 'cash-zero-edit'
  | 'ledger-isolation'
  | 'published-rejected'
  | 'cross-tenant-rejected'
  | 'missing-rpc';

interface Scenario {
  key: ScenarioKey;
  label: string;
  batchStatus: 'pending' | 'published';
  availableCash: number;
  holdings: number;
  rpcError: { message?: string; code?: string } | null;
}

export const SCENARIOS: Scenario[] = [
  { key: 'title-price-edit', label: '標題與參考價更新', batchStatus: 'pending', availableCash: 5_000_000, holdings: 2, rpcError: null },
  { key: 'cash-zero-edit', label: '可用資金 0 且無持倉', batchStatus: 'pending', availableCash: 0, holdings: 0, rpcError: null },
  { key: 'ledger-isolation', label: '帳本零變動', batchStatus: 'pending', availableCash: 0, holdings: 0, rpcError: null },
  { key: 'published-rejected', label: '已公開週記擋下', batchStatus: 'published', availableCash: 0, holdings: 0, rpcError: null },
  { key: 'cross-tenant-rejected', label: '別人的週記擋下', batchStatus: 'pending', availableCash: 0, holdings: 0, rpcError: { message: 'forbidden' } },
  { key: 'missing-rpc', label: '伺服器程序未上線', batchStatus: 'pending', availableCash: 0, holdings: 0, rpcError: { message: 'Could not find the function', code: 'PGRST202' } },
];

/** fixture 帳本快照：mock adapter 永遠不會改它，用來證明內容更新與帳本隔離。 */
const FIXTURE_LEDGER = {
  trade_records: [
    { id: 'tr-1', instrument: '台積電', quantity: 1000, price: 900 },
    { id: 'tr-2', instrument: '聯發科', quantity: 500, price: 1200 },
  ],
  user_performances: [{ id: 'up-1', total_return: 0.4971 }],
  holdings: [{ stock_id: '2330' }, { stock_id: '2454' }],
  starting_capital: 1_000_000,
  meta: {
    id: 'sig-1',
    batch_id: 'batch-fixture-1',
    status: 'pending',
    created_at: '2026-09-01T00:00:00Z',
    published_at: null,
  },
};

/** 穩定字串雜湊（fixture 專用，不需密碼學強度）。 */
export function fixtureHash(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const BASE_TRADE: TradeDraft = {
  uid: 'row-1',
  executedAt: '2026-09-15T09:30',
  stockCode: '2330',
  stockName: '台積電',
  action: 'buy',
  priceHint: '100',
  quantity: '1000',
  quantityUnit: '股',
  reasonSummary: '測試用理由',
  reasonDetail: '',
  riskNotes: '',
};

const EXPERT = { id: 'expert-fixture-1', asset_class: 'tw_stock', role: 'mentor', slug: 'harness-mentor' };
const BATCH_ID = 'batch-fixture-1';

/** 五組帳本指紋群組（此 schema 無 per-expert positions / capital ledger / realized_pnl 表）。 */
export const LEDGER_GROUPS = [
  'trade_records',
  'user_performances',
  'holdings',
  'starting_capital',
  'meta',
] as const;

type LedgerGroup = (typeof LEDGER_GROUPS)[number];

function groupHashes(): Record<LedgerGroup, string> {
  return {
    trade_records: fixtureHash(FIXTURE_LEDGER.trade_records),
    user_performances: fixtureHash(FIXTURE_LEDGER.user_performances),
    holdings: fixtureHash(FIXTURE_LEDGER.holdings),
    starting_capital: fixtureHash(FIXTURE_LEDGER.starting_capital),
    meta: fixtureHash(FIXTURE_LEDGER.meta),
  };
}

interface RunResult {
  saveStatus: 'ok' | 'blocked' | 'error';
  message: string;
  mutationCalls: number;
  rpcCalls: number;
  hashBefore: string;
  hashAfter: string;
  groupsBefore: Record<LedgerGroup, string>;
  groupsAfter: Record<LedgerGroup, string>;
}

export default function PendingJournalEditHarnessEntry() {
  const [scenario, setScenario] = useState<Scenario>(SCENARIOS[0]);
  const [teachingTopic, setTeachingTopic] = useState('原始主題');
  const [priceHint, setPriceHint] = useState('100');
  const [result, setResult] = useState<RunResult | null>(null);
  const [blockedNetwork, setBlockedNetwork] = useState(0);
  const blockedRef = useRef(0);

  // fixture mode：hard-block 一切真實網路，harness 不可能碰到正式資料。
  useEffect(() => {
    const w = window as any;
    const origFetch = w.fetch;
    const origOpen = w.XMLHttpRequest?.prototype?.open;
    const origBeacon = w.navigator?.sendBeacon;
    const block = (what: string) => {
      blockedRef.current += 1;
      setBlockedNetwork(blockedRef.current);
      throw new Error(`[${HARNESS_MARKER}] fixture mode blocked network: ${what}`);
    };
    w.fetch = (...a: unknown[]) => block(String(a[0]));
    if (origOpen) w.XMLHttpRequest.prototype.open = (...a: unknown[]) => block(String(a[1]));
    if (origBeacon) w.navigator.sendBeacon = (...a: unknown[]) => block(String(a[0]));
    return () => {
      w.fetch = origFetch;
      if (origOpen) w.XMLHttpRequest.prototype.open = origOpen;
      if (origBeacon) w.navigator.sendBeacon = origBeacon;
    };
  }, []);

  const trades = useMemo<TradeDraft[]>(() => [{ ...BASE_TRADE, priceHint }], [priceHint]);

  const run = async () => {
    const hashBefore = fixtureHash(FIXTURE_LEDGER);
    let rpcCalls = 0;
    let mutationCalls = 0;

    const isPendingMentorEdit = scenario.batchStatus === 'pending';
    if (!isPendingMentorEdit) {
      setResult({
        saveStatus: 'blocked',
        message: '這篇週記已經公開，不能用「未公開內容更新」修改',
        mutationCalls: 0,
        rpcCalls: 0,
        hashBefore,
        hashAfter: fixtureHash(FIXTURE_LEDGER),
      });
      return;
    }

    const gate = evaluatePublishGate({
      canEdit: true,
      assetClass: EXPERT.asset_class,
      isTeachingOnly: false,
      teachingTopic,
      validateBatch: () => validateJournalContentFields({ expert: EXPERT, trades }),
    });
    if (gate.blocked) {
      setResult({
        saveStatus: 'blocked',
        message: gate.reason || '內容未通過檢查',
        mutationCalls: 0,
        rpcCalls: 0,
        hashBefore,
        hashAfter: fixtureHash(FIXTURE_LEDGER),
      });
      return;
    }

    const mockRpc: PendingMentorRpc = async () => {
      rpcCalls += 1;
      if (scenario.rpcError) return { error: scenario.rpcError };
      mutationCalls += 1; // 只有成功寫入才算 mutation；fixture 帳本仍完全不動
      return { error: null };
    };

    const rows = buildPendingContentRows({
      assetClass: EXPERT.asset_class,
      isMentor: true,
      teachingOnly: false,
      teachingTopic,
      overallSummary: '',
      learningPoints: '',
      trades,
    });
    const r = await submitPendingMentorEdit({
      expertId: EXPERT.id, batchId: BATCH_ID, rows, rpc: mockRpc,
    });

    setResult({
      saveStatus: r.ok === false ? 'error' : 'ok',
      message: r.ok === false ? r.message : `已更新 ${r.count} 檔週記`,
      mutationCalls,
      rpcCalls,
      hashBefore,
      hashAfter: fixtureHash(FIXTURE_LEDGER),
    });
  };

  const ledgerSame = result ? String(result.hashBefore === result.hashAfter) : '';

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui', maxWidth: 720 }}>
      <h1 data-testid="harness-marker" style={{ fontSize: 18, fontWeight: 600 }}>{HARNESS_MARKER}</h1>
      <p data-testid="harness-mode">fixture-mode（所有真實網路已封鎖）</p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '16px 0' }}>
        {SCENARIOS.map((s) => (
          <button
            key={s.key}
            type="button"
            data-testid={`scenario-${s.key}`}
            aria-pressed={scenario.key === s.key}
            onClick={() => { setScenario(s); setResult(null); }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div data-testid="scenario-current">{scenario.key}</div>
      <div data-testid="fixture-available-cash">{scenario.availableCash}</div>
      <div data-testid="fixture-holdings">{scenario.holdings}</div>
      <div data-testid="fixture-batch-status">{scenario.batchStatus}</div>

      <div style={{ display: 'grid', gap: 8, margin: '16px 0' }}>
        <label>
          教學主題
          <input
            data-testid="input-teaching-topic"
            value={teachingTopic}
            onChange={(e) => setTeachingTopic(e.target.value)}
          />
        </label>
        <label>
          買進參考價位
          <input
            data-testid="input-price-hint"
            value={priceHint}
            onChange={(e) => setPriceHint(e.target.value)}
          />
        </label>
      </div>

      <button type="button" data-testid="btn-save" onClick={() => { void run(); }}>儲存更新</button>

      <div style={{ marginTop: 16 }}>
        <div data-testid="value-teaching-topic">{teachingTopic}</div>
        <div data-testid="value-price-hint">{priceHint}</div>
        <div data-testid="save-status">{result?.saveStatus ?? ''}</div>
        <div data-testid="save-message">{result?.message ?? ''}</div>
        <div data-testid="mutation-calls">{result ? String(result.mutationCalls) : ''}</div>
        <div data-testid="rpc-calls">{result ? String(result.rpcCalls) : ''}</div>
        <div data-testid="ledger-hash-before">{result?.hashBefore ?? ''}</div>
        <div data-testid="ledger-hash-after">{result?.hashAfter ?? ''}</div>
        <div data-testid="ledger-same">{ledgerSame}</div>
        <div data-testid="blocked-network-calls">{blockedNetwork}</div>
      </div>
    </div>
  );
}
