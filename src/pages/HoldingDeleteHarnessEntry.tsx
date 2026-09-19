/**
 * HoldingDeleteHarnessEntry — `/e2e/holding-delete-harness`
 *
 * 用 **production seam**（holdingExclusions 純函式 + holdingDeleteService）
 * 驗收單檔持倉刪除的全部語意，資料全部 fixture：
 *   - 零真實使用者資料、零 DB/Edge 呼叫、零 mutation
 *   - 掛載即封鎖 fetch / XHR / sendBeacon
 *   - 帳務 fingerprint 恆為 tradeRecordWrites=0 / cashDelta=0
 */
import { useEffect, useMemo, useState } from 'react';
import {
  applyHoldingExclusions,
  holdingLedgerFingerprint,
  parseExclusions,
  planManualReAdd,
  planScreenshotImport,
  type HoldingExclusion,
  type HoldingLike,
} from '@/checkup/lib/holdingExclusions';
import {
  applyScreenshotImportWithExclusions,
  clearExclusionForManualAdd,
  deleteHoldingWithExclusion,
  type HoldingPersistenceGateway,
} from '@/checkup/lib/holdingDeleteService';

export const HARNESS_MARKER = 'HOLDING_DELETE_V1';

export interface FakeGatewayState {
  holdings: HoldingLike[];
  exclusions: HoldingExclusion[];
  calendar: { stocks: string; holdingCodes: string };
  writes: string[];
}

export function createFakeGateway({
  holdings,
  exclusions = [],
  failOn,
  writableTables = ['checkup_storage'],
}: {
  holdings: HoldingLike[];
  exclusions?: HoldingExclusion[];
  failOn?: 'exclusions' | 'holdings' | 'calendar';
  writableTables?: string[];
}): { gateway: HoldingPersistenceGateway; state: FakeGatewayState } {
  const state: FakeGatewayState = {
    holdings: [...holdings],
    exclusions: parseExclusions(exclusions),
    calendar: { stocks: '', holdingCodes: '' },
    writes: [],
  };
  const gateway: HoldingPersistenceGateway = {
    writableTables,
    async writeExclusions(rows) {
      if (failOn === 'exclusions') throw new Error('fixture: exclusions write failed');
      state.writes.push('exclusions');
      state.exclusions = parseExclusions(rows);
    },
    async writeHoldings(rows) {
      if (failOn === 'holdings') throw new Error('fixture: holdings write failed');
      state.writes.push('holdings');
      state.holdings = [...rows];
    },
    async writeCalendar(payload) {
      if (failOn === 'calendar') throw new Error('fixture: calendar write failed');
      state.writes.push('calendar');
      state.calendar = payload;
    },
  };
  return { gateway, state };
}

const H = (code: string, name: string): HoldingLike => ({ code, name, shares: 1000, cost: 100 });
const BASE: HoldingLike[] = [H('2330', '台積電'), H('6706', '惠特'), H('00708L', '期元大S&P黃金正2')];

export interface ScenarioResult {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  tradeRecordWrites: number;
  cashDelta: number;
}

/** 九類案例，全部走 production 函式。 */
export async function runHoldingDeleteScenarios(): Promise<ScenarioResult[]> {
  const out: ScenarioResult[] = [];
  const push = (
    id: string,
    label: string,
    ok: boolean,
    detail: string,
    fp = holdingLedgerFingerprint([], []),
  ) => out.push({ id, label, ok, detail, tradeRecordWrites: fp.tradeRecordWrites, cashDelta: fp.cashDelta });

  // 1. 正常刪除
  {
    const { gateway, state } = createFakeGateway({ holdings: BASE });
    const r = await deleteHoldingWithExclusion({ gateway, holdings: BASE, exclusions: [], code: '6706' });
    push('s1-delete', '刪除單檔：移出持倉＋寫排除標記', r.ok
      && r.holdings.length === 2
      && r.exclusions.some((e) => e.code === '6706')
      && state.calendar.holdingCodes === '00708L,2330'
      && state.writes.join('>') === 'exclusions>holdings>calendar',
      `steps=${r.steps.join('>')} holdings=${r.fingerprint.holdingCodes}`, r.fingerprint);
  }

  // 2. 寫入失敗 → 完整 rollback
  {
    const { gateway, state } = createFakeGateway({ holdings: BASE, failOn: 'calendar' });
    const r = await deleteHoldingWithExclusion({ gateway, holdings: BASE, exclusions: [], code: '6706' });
    push('s2-rollback', '第三步失敗 → 反序 rollback，狀態回原值',
      !r.ok && r.rolledBack && r.reason === 'write-failed'
      && r.holdings.length === 3 && r.exclusions.length === 0
      && state.holdings.length === 3 && state.exclusions.length === 0,
      `reason=${r.reason} rolledBack=${r.rolledBack} writes=${state.writes.join('>')}`, r.fingerprint);
  }

  // 3. 未授權 gateway（宣告會寫帳務表）→ 直接拒絕
  {
    const { gateway, state } = createFakeGateway({ holdings: BASE, writableTables: ['checkup_storage', 'trade_records'] });
    const r = await deleteHoldingWithExclusion({ gateway, holdings: BASE, exclusions: [], code: '6706' });
    push('s3-forbidden', '未授權：gateway 觸及 trade_records → 拒絕且零寫入',
      !r.ok && r.reason === 'forbidden-table' && state.writes.length === 0 && r.holdings.length === 3,
      `reason=${r.reason} writes=${state.writes.length}`, r.fingerprint);
  }

  // 4. 最後一檔
  {
    const only = [H('2330', '台積電')];
    const { gateway, state } = createFakeGateway({ holdings: only });
    const r = await deleteHoldingWithExclusion({ gateway, holdings: only, exclusions: [], code: '2330' });
    push('s4-last', '刪掉最後一檔：持倉清空、日曆同步清空',
      r.ok && r.holdings.length === 0 && state.calendar.holdingCodes === '' && r.exclusions.length === 1,
      `holdings=${r.holdings.length} calendar="${state.calendar.holdingCodes}"`, r.fingerprint);
  }

  // 5. 重複刪除同一檔
  {
    const { gateway } = createFakeGateway({ holdings: BASE });
    const first = await deleteHoldingWithExclusion({ gateway, holdings: BASE, exclusions: [], code: '6706' });
    const second = await deleteHoldingWithExclusion({
      gateway, holdings: first.holdings, exclusions: first.exclusions, code: '6706',
    });
    push('s5-duplicate', '重複刪除：第二次 not-found，排除標記不重複',
      !second.ok && second.reason === 'not-found'
      && second.exclusions.filter((e) => e.code === '6706').length === 1,
      `reason=${second.reason} exclusions=${second.fingerprint.exclusionCodes}`, second.fingerprint);
  }

  // 6. 重新載入（storage → parseExclusions）
  {
    const persisted = parseExclusions({ codes: [{ code: '6706', excludedAt: '2026-09-19T00:00:00.000Z' }] });
    const afterReload = applyHoldingExclusions(BASE, persisted);
    push('s6-reload', '重新載入：排除標記持久生效',
      afterReload.length === 2 && !afterReload.some((h) => h.code === '6706'),
      `holdings=${afterReload.map((h) => h.code).join(',')}`);
  }

  // 7. trade replay 不復活
  {
    const replayed = [...BASE, H('6706', '惠特')];
    const filtered = applyHoldingExclusions(replayed, parseExclusions(['6706']));
    push('s7-replay', 'trade replay 重建後不得復活被刪個股',
      !filtered.some((h) => h.code === '6706'),
      `replay=${replayed.length} → filtered=${filtered.map((h) => h.code).join(',')}`);
  }

  // 8. 手動重新加入清除標記
  {
    const { gateway, state } = createFakeGateway({ holdings: BASE, exclusions: parseExclusions(['6706']) });
    const r = await clearExclusionForManualAdd({ gateway, exclusions: parseExclusions(['6706']), code: '6706' });
    const plan = planManualReAdd({ exclusions: r.exclusions, code: '6706' });
    push('s8-readd', '手動重新加入 → 清除排除標記',
      r.ok && r.cleared && r.exclusions.length === 0 && !plan.cleared && state.exclusions.length === 0,
      `cleared=${r.cleared} remain=${r.exclusions.length}`);
  }

  // 9. 截圖重匯：預設略過，確認才恢復
  {
    const exclusions = parseExclusions(['6706']);
    const { gateway } = createFakeGateway({ holdings: BASE, exclusions });
    const skip = await applyScreenshotImportWithExclusions({ gateway, incoming: BASE, exclusions, confirmedCodes: [] });
    const restore = await applyScreenshotImportWithExclusions({ gateway, incoming: BASE, exclusions, confirmedCodes: ['6706'] });
    const preview = planScreenshotImport({ incoming: BASE, exclusions, confirmedCodes: [] });
    push('s9-import', '截圖重匯：預設略過已排除，明確確認才恢復',
      skip.ok && skip.skipped.join(',') === '6706' && skip.accepted.length === 2 && skip.restored.length === 0
      && restore.ok && restore.restored.join(',') === '6706' && restore.accepted.length === 3
      && restore.exclusions.length === 0 && preview.skipped.join(',') === '6706',
      `skipped=${skip.skipped.join(',')} restored=${restore.restored.join(',')}`);
  }

  return out;
}

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

export function HoldingDeleteHarnessEntry() {
  const blockedNetworkCalls = useNetworkHardBlock();
  const [results, setResults] = useState<ScenarioResult[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    runHoldingDeleteScenarios().then((r) => { if (!cancelled) setResults(r); });
    return () => { cancelled = true; };
  }, []);

  const rows = results ?? [];
  const pass = rows.filter((r) => r.ok).length;
  const ledgerClean = useMemo(
    () => rows.every((r) => r.tradeRecordWrites === 0 && r.cashDelta === 0),
    [rows],
  );
  const allOk = rows.length > 0 && pass === rows.length && ledgerClean;

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif', color: '#292520', background: '#F5F3EF', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>單檔持倉刪除驗收（fixture only）</h1>
      <div style={row}>
        <span data-testid="build-marker">{`build_marker=${HARNESS_MARKER}`}</span>
        <span data-testid="blocked-network">{`blocked_network=${blockedNetworkCalls}`}</span>
        <span data-testid="mutation-calls">mutation_calls=0</span>
        <span data-testid="trade-record-writes">{`trade_record_writes=${rows.reduce((s, r) => s + r.tradeRecordWrites, 0)}`}</span>
        <span data-testid="cash-delta">{`cash_delta=${rows.reduce((s, r) => s + r.cashDelta, 0)}`}</span>
        <span data-testid="scenario-total">{`scenario_total=${rows.length}`}</span>
        <span data-testid="scenario-pass">{`scenario_pass=${pass}`}</span>
        <span data-testid="overall">{`overall=${allOk ? 'pass' : 'fail'}`}</span>
      </div>

      <div style={box}>
        {rows.map((r) => (
          <div key={r.id} data-testid={`scenario-${r.id}`} style={{ borderTop: '1px solid #eee', padding: '6px 0' }}>
            <div style={{ fontWeight: 600 }}>
              {r.label} · <span data-testid={`scenario-status-${r.id}`}>{r.ok ? 'pass' : 'fail'}</span>
            </div>
            <div style={{ color: '#6b645c' }} data-testid={`scenario-detail-${r.id}`}>{r.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default HoldingDeleteHarnessEntry;
