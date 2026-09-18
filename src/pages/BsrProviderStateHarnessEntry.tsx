/**
 * BsrProviderStateHarnessEntry — `/e2e/bsr-provider-state-harness`
 *
 * 目的：在 hosted Preview 用 **production seam** 驗收券商分點（BSR）授權狀態呈現：
 *   - `resolveCardChipsFact`（卡片列）
 *   - `buildFreshnessSegments`（抽屜分段新鮮度：法人／分點各自獨立）
 *   - `resolveBsrRetryNote`（回推區間的唯一決策點）
 *   - `decideCaptchaFallback`（TWSE 驗證碼舊路徑 fail-closed selector）
 *
 * 憲法：
 *   - 不複製任何判斷邏輯，只餵 fixture payload 給上述 production 函式。
 *   - fixture mode 掛載即封鎖 fetch / XHR / sendBeacon，production adapter 永不觸發。
 *   - 只渲染 fixture，零真實使用者資料、零 DB/Edge 呼叫。
 */
import { useEffect, useMemo, useState } from 'react';
import type { ChipsFetchResult } from '@/checkup/lib/chipsRepository';
import { resolveCardChipsFact } from '@/checkup/lib/cardChipsFact';
import { buildFreshnessSegments } from '@/checkup/components/freecheckup/chipsFreshnessSegments';
import { decideCaptchaFallback, resolveBsrRetryNote } from '@/checkup/lib/bsrProviderPresentation';

export const HARNESS_MARKER = 'BSR_ENTITLEMENT_RECOVERY_UI_V1';

type ScenarioId =
  | 'fresh'
  | 'terminal_provider_rejected'
  | 'transient_with_range'
  | 'stale_no_failure'
  | 'not_applicable';

interface LastFailureFixture {
  trade_date: string;
  lookback_from?: string | null;
  lookback_to?: string | null;
  lookback_days?: number | null;
  last_successful_as_of?: string | null;
}

interface Scenario {
  id: ScenarioId;
  label: string;
  code: string;
  payload: Record<string, unknown>;
  lastFailure: LastFailureFixture | null;
}

const INSTITUTIONAL_FRESH = {
  d1: { foreign_net: -424791, trust_net: -14000, dealer_net: 5911, total_net: -432880, days_covered: 1 },
  d5: null,
  d20: null,
  d60: null,
};

const SCENARIOS: Scenario[] = [
  {
    id: 'fresh',
    label: 'fresh（兩邊都最新）',
    code: '2330',
    payload: {
      stock_id: '2330',
      as_of: '2026-09-16',
      as_of_lag_days: 0,
      institutional: INSTITUTIONAL_FRESH,
      bsr: { d5: null, d20: null, d60: null },
      bsr_as_of: '2026-09-16',
      bsr_freshness_status: 'fresh',
    },
    lastFailure: null,
  },
  {
    id: 'terminal_provider_rejected',
    label: 'terminal_provider_rejected（更新暫停）',
    code: '2478',
    payload: {
      stock_id: '2478',
      as_of: '2026-09-16',
      as_of_lag_days: 0,
      institutional: INSTITUTIONAL_FRESH,
      bsr: { d5: null, d20: null, d60: null },
      bsr_as_of: '2026-08-14',
      bsr_freshness_status: 'syncing',
      bsr_provider_state: 'terminal_provider_rejected',
      bsr_provider_code: 'provider_plan_rejected',
    },
    lastFailure: { trade_date: '2026-08-17', lookback_from: null, lookback_to: null, lookback_days: null },
  },
  {
    id: 'transient_with_range',
    label: 'transient_with_range（真實回推區間）',
    code: '2308',
    payload: {
      stock_id: '2308',
      as_of: '2026-09-16',
      as_of_lag_days: 0,
      institutional: INSTITUTIONAL_FRESH,
      bsr: { d5: null, d20: null, d60: null },
      bsr_as_of: '2026-09-10',
      bsr_freshness_status: 'syncing',
      bsr_provider_state: 'retryable',
    },
    lastFailure: {
      trade_date: '2026-09-16',
      lookback_from: '2026-09-16',
      lookback_to: '2026-09-11',
      lookback_days: 4,
      last_successful_as_of: '2026-09-10',
    },
  },
  {
    id: 'stale_no_failure',
    label: 'stale_no_failure（落後但無失敗紀錄）',
    code: '2313',
    payload: {
      stock_id: '2313',
      as_of: '2026-09-16',
      as_of_lag_days: 0,
      institutional: INSTITUTIONAL_FRESH,
      bsr: { d5: null, d20: null, d60: null },
      bsr_as_of: '2026-09-10',
      bsr_freshness_status: 'lagging',
      bsr_lag_weekdays: 4,
    },
    lastFailure: null,
  },
  {
    id: 'not_applicable',
    label: 'not_applicable（ETF／權證）',
    code: '0050',
    payload: {
      stock_id: '0050',
      as_of: '2026-09-16',
      as_of_lag_days: 0,
      institutional: INSTITUTIONAL_FRESH,
      bsr: { d5: null, d20: null, d60: null },
      bsr_as_of: null,
      bsr_freshness_status: 'ineligible',
      bsr_provider_state: 'ineligible',
      bsr_provider_code: 'ineligible',
    },
    lastFailure: null,
  },
];

/** fixture mode：封鎖所有真實網路出口，production adapter 一旦被觸發就會爆。 */
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
      /* 某些環境不可覆寫，忽略 */
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
const row: React.CSSProperties = { display: 'flex', gap: 8, padding: '2px 0' };

export function BsrProviderStateHarnessEntry() {
  const blockedNetworkCalls = useNetworkHardBlock();
  const [scenarioId, setScenarioId] = useState<ScenarioId>('terminal_provider_rejected');
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;

  const view = useMemo(() => {
    const chipsData = { payload: scenario.payload } as unknown as ChipsFetchResult;
    const fact = resolveCardChipsFact(chipsData, { kind: 'ok' });
    const [inst, bsr] = buildFreshnessSegments(scenario.payload as never);
    const terminal = fact.bsrState === 'unavailable_unsupported';
    const note = scenario.lastFailure
      ? resolveBsrRetryNote({
          terminal,
          lookbackFrom: scenario.lastFailure.lookback_from ?? null,
          lookbackTo: scenario.lastFailure.lookback_to ?? null,
          lookbackDays: scenario.lastFailure.lookback_days ?? null,
          tradeDate: scenario.lastFailure.trade_date,
        })
      : null;
    const captcha = decideCaptchaFallback({
      providerState: (scenario.payload.bsr_provider_state as string | undefined) ?? null,
      providerCode: (scenario.payload.bsr_provider_code as string | undefined) ?? null,
    });
    return { fact, inst, bsr, note, captcha };
  }, [scenario]);

  return (
    <main style={{ padding: 20, fontFamily: 'system-ui, sans-serif', color: '#292520' }}>
      <h1 data-testid="harness-marker" style={{ fontSize: 16, fontWeight: 700 }}>
        {HARNESS_MARKER}
      </h1>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            data-testid={`scenario-${s.id}`}
            onClick={() => setScenarioId(s.id)}
            style={{
              border: '1px solid #ccc6bc',
              padding: '4px 10px',
              fontSize: 12,
              background: s.id === scenarioId ? '#292520' : 'transparent',
              color: s.id === scenarioId ? '#fff' : '#292520',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <section style={box} data-testid="harness-result" data-scenario={scenario.id}>
        <div style={row}>
          <span>code：</span>
          <b data-testid="fixture-code">{scenario.code}</b>
        </div>
        <div style={row}>
          <span>卡片主要：</span>
          <span data-testid="card-primary">{view.fact.text}</span>
        </div>
        <div style={row}>
          <span>卡片次要：</span>
          <span data-testid="card-secondary">{view.fact.secondaryText ?? ''}</span>
        </div>
        <div style={row}>
          <span>卡片 kind／BSR state：</span>
          <span data-testid="card-kind">{view.fact.kind}</span>
          <span data-testid="card-bsr-state">{view.fact.bsrState}</span>
        </div>
        <div style={row}>
          <span>三大法人段：</span>
          <span data-testid="seg-institutional-state">{view.inst.state}</span>
          <span data-testid="seg-institutional-text">{view.inst.text}</span>
          <span data-testid="seg-institutional-as-of">{view.inst.asOf ?? ''}</span>
        </div>
        <div style={row}>
          <span>券商分點段：</span>
          <span data-testid="seg-bsr-state">{view.bsr.state}</span>
          <span data-testid="seg-bsr-text">{view.bsr.text}</span>
          <span data-testid="seg-bsr-as-of">{view.bsr.asOf ?? ''}</span>
        </div>
        <div style={row}>
          <span>回推說明：</span>
          <span data-testid="retry-note-kind">{view.note?.kind ?? 'no_failure_record'}</span>
          <span data-testid="retry-note-text">{view.note?.text ?? ''}</span>
        </div>
        <div style={row}>
          <span>CAPTCHA fallback：</span>
          <span data-testid="captcha-allowed">{String(view.captcha.allowed)}</span>
          <span data-testid="captcha-reason">{view.captcha.reason ?? ''}</span>
        </div>
        <div style={row}>
          <span>被擋下的真實網路呼叫：</span>
          <span data-testid="blocked-network-calls">{blockedNetworkCalls}</span>
        </div>
      </section>

      <p style={{ marginTop: 16, fontSize: 12, color: '#6b655c' }}>
        本頁為 fixture 驗收頁，不代表真實資料已更新。
      </p>
    </main>
  );
}

export default BsrProviderStateHarnessEntry;
