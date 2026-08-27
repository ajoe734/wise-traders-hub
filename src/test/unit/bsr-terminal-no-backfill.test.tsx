/**
 * Stage 3B / S3B-0 RED test — terminal provider state 下必須完全停止回補
 *
 * 契約（v4.1 §S3B-D）：
 *   1. ChipsBackfillSnapshot 要帶 providerState；terminal 時 shouldAutoTrigger() 必為 false。
 *   2. reducer 收到 terminal snapshot 不得產生 requestBackfill effect（即使 sparse 且 eligible）。
 *   3. ChipsSection 的手動「立即回補」按鈕在 terminal 時不得渲染。
 *
 * 目前預期 RED，失敗點：
 *   - chipsBackfillMachine 沒有 providerState 這個欄位，terminal 一樣會 requestBackfill。
 *   - ChipsSection 只把 providerState 用在標題文案，未 gate 回補按鈕。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  chipsBackfillReducer,
  shouldAutoTrigger,
  initialChipsBackfillState,
} from '@/checkup/lib/chipsBackfillMachine';

const TERMINAL = 'terminal_provider_rejected';

function snapshot(extra: Record<string, unknown> = {}) {
  return {
    stockCode: '2330',
    hasData: true,
    sparse: true,
    eligible: true,
    syncStatus: null,
    satisfied: false,
    now: 1_700_000_000_000,
    ...extra,
  } as any;
}

describe('S3B RED · terminal provider 不得觸發回補', () => {
  it('shouldAutoTrigger(terminal) 必須為 false', () => {
    expect(
      shouldAutoTrigger(initialChipsBackfillState, snapshot({ providerState: TERMINAL })),
      'RED: machine 尚未認得 providerState，terminal 仍被判定應自動回補',
    ).toBe(false);
  });

  it('reducer 收到 terminal snapshot 不得產生 requestBackfill effect', () => {
    const { effects, state } = chipsBackfillReducer(initialChipsBackfillState, {
      type: 'snapshot',
      snapshot: snapshot({ providerState: TERMINAL }),
    } as any);
    expect(
      effects.some((e) => e.type === 'requestBackfill'),
      'RED: terminal 狀態仍發出 requestBackfill',
    ).toBe(false);
    expect(state.phase, 'RED: terminal 狀態不得進入 triggered').toBe('idle');
  });

  it('非 terminal 的 sparse 情境仍必須照常回補（不得因修法而全面停擺）', () => {
    const { effects } = chipsBackfillReducer(initialChipsBackfillState, {
      type: 'snapshot',
      snapshot: snapshot({ providerState: 'available' }),
    } as any);
    expect(effects.some((e) => e.type === 'requestBackfill')).toBe(true);
  });

  it('ChipsSection 手動回補按鈕必須被 terminal 狀態 gate 住', () => {
    const s = readFileSync(
      resolve(process.cwd(), 'src/checkup/components/freecheckup/ChipsSection.tsx'),
      'utf8',
    );
    const gated = /isTerminal|terminal_provider_rejected|BSR_TERMINAL_PROVIDER_STATE/.test(s)
      && /!\s*is[A-Za-z]*Terminal[A-Za-z]*\s*&&/.test(s);
    expect(gated, 'RED: ChipsSection 未以 terminal 狀態 gate 手動回補按鈕').toBe(true);
  });
});

/* ── v4.2 §B4：抽屜手動回補在 terminal 時必須 fail-closed ─────────────── */
import { canRequestBackfill } from '@/checkup/lib/bsrCanonicalCodes';

describe('Stage D · D4 手動回補 fail-closed', () => {
  it('canRequestBackfill(terminal) === false，非 terminal === true', () => {
    expect(canRequestBackfill({ terminalUnavailable: true })).toBe(false);
    expect(canRequestBackfill({ terminalUnavailable: false })).toBe(true);
    expect(canRequestBackfill(null)).toBe(true);
  });

  it('useChipsLifecycle 的 handleBackfill 必須以 canonical mapper gate 住', () => {
    const s = readFileSync(resolve(process.cwd(), 'src/checkup/hooks/useChipsLifecycle.ts'), 'utf8');
    expect(s.includes('canRequestBackfill'), 'handleBackfill 未使用 canonical gate').toBe(true);
    expect(/canRequestBackfill\([^)]*facts[^)]*\)/.test(s)).toBe(true);
  });
});

/* ── v4.3 §F1/§F2：public useChipsLifecycle.requestBackfill 的 runtime 契約 ───
 * 只 mock 最低層 gateway（createFakeGateway + setCheckupGateway）與 repository 取數；
 * 禁止 mock useChipsBackfill / requestBackfill / useChipsAutoBackfill / canRequestBackfill，
 * 真實碼必須跑到 Promise.allSettled([invoke(...), rpc(...)])。
 */
import { vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fetchChipsPayloadMock = vi.fn();
const fetchChipsStampMock = vi.fn();

vi.mock('@/checkup/lib/chipsRepository', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    fetchChipsPayload: (...a: unknown[]) => fetchChipsPayloadMock(...a),
    fetchChipsStamp: (...a: unknown[]) => fetchChipsStampMock(...a),
  };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/trafficTracker', () => ({ trackEvent: vi.fn(), trackRaw: vi.fn() }));

import { createFakeGateway, setCheckupGateway, resetCheckupGateway } from '@/checkup/lib/gateway';
import { useChipsLifecycle } from '@/checkup/hooks/useChipsLifecycle';
import { __resetChipsBackfillBudget } from '@/checkup/hooks/useChipsBackfill';

function series(n: number) {
  return Array.from({ length: n }, (_, i) => ({ date: `2026-07-${String((i % 28) + 1).padStart(2, '0')}` }));
}

/** terminal：provider 永久拒絕（sparse 且 eligible → 若沒有 gate 必定回補）。 */
const TERMINAL_PAYLOAD = {
  stock_id: '2330',
  bsr_provider_state: 'terminal_provider_rejected',
  bsr_provider_code: 'bsr_provider_unsupported',
  bsr_sync_status: { status: null, eligible: true, provider_state: 'terminal_provider_rejected' },
  series: { institutional_daily: series(3), bsr_concentration: [] },
};

/** transient control：非 terminal 且 **non-sparse**（instDays 30 / bsrDays 10）→ auto machine 恆不觸發。 */
const TRANSIENT_PAYLOAD = {
  stock_id: '2330',
  bsr_provider_state: 'available',
  bsr_sync_status: { status: null, eligible: true, provider_state: 'available' },
  series: { institutional_daily: series(30), bsr_concentration: series(10) },
  readiness: { institutional: { '60': { state: 'ready' }, '20': { state: 'ready' } } },
};

function renderLifecycle() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(() => useChipsLifecycle('2330', true), { wrapper });
}

describe('Stage D · v4.3 F1/F2 · public requestBackfill 的 endpoint 契約', () => {
  let gw: ReturnType<typeof createFakeGateway>;
  let invokeSpy: ReturnType<typeof vi.spyOn>;
  let rpcSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetChipsBackfillBudget();
    fetchChipsStampMock.mockResolvedValue({ stamp_ver: 'v1' });
    gw = createFakeGateway({
      functions: { 'tw-institutional-daily-sync': { ok: true } },
      rpcs: { enqueue_bsr_backfill: 3 },
    });
    invokeSpy = vi.spyOn(gw, 'invoke');
    rpcSpy = vi.spyOn(gw, 'rpc');
    setCheckupGateway(gw);
  });

  afterEach(() => {
    resetCheckupGateway();
    vi.clearAllMocks();
  });

  it('F1 terminal：public requestBackfill 後 enqueue_bsr_backfill 與 tw-institutional-daily-sync 皆 exact 0', async () => {
    fetchChipsPayloadMock.mockResolvedValue({
      payload: TERMINAL_PAYLOAD, stampVer: 'v1', bytes: 0, durationMs: 0,
    });
    const { result } = renderLifecycle();

    await waitFor(() => expect(result.current.facts.terminalUnavailable).toBe(true));
    await act(async () => { await result.current.requestBackfill(); });
    await new Promise((r) => setTimeout(r, 500));

    const invokeNames = invokeSpy.mock.calls.map((c) => c[0]);
    const rpcNames = rpcSpy.mock.calls.map((c) => c[0]);
    expect(
      invokeNames.filter((n) => n === 'tw-institutional-daily-sync').length,
      'RED: terminal 仍呼叫 tw-institutional-daily-sync',
    ).toBe(0);
    expect(
      rpcNames.filter((n) => n === 'enqueue_bsr_backfill').length,
      'RED: terminal 仍呼叫 enqueue_bsr_backfill',
    ).toBe(0);
  });

  it('F2 transient control（non-terminal + non-sparse）：auto 0 次，manual 一次 → 兩端點 exact 1/1 且參數精確', async () => {
    fetchChipsPayloadMock.mockResolvedValue({
      payload: TRANSIENT_PAYLOAD, stampVer: 'v1', bytes: 0, durationMs: 0,
    });
    const { result } = renderLifecycle();

    await waitFor(() => {
      expect(result.current.facts.sparse).toBe(false);
      expect(result.current.facts.terminalUnavailable).toBe(false);
    });
    await new Promise((r) => setTimeout(r, 300));

    // auto machine 必須 0 次（non-sparse），manual 之前先證明。
    const autoInvokes = invokeSpy.mock.calls.filter((c) => c[0] === 'tw-institutional-daily-sync').length;
    const autoRpcs = rpcSpy.mock.calls.filter((c) => c[0] === 'enqueue_bsr_backfill').length;
    expect(autoInvokes, 'auto backfill 不得先行觸發 invoke').toBe(0);
    expect(autoRpcs, 'auto backfill 不得先行觸發 rpc').toBe(0);

    await act(async () => { await result.current.requestBackfill(); });

    expect(invokeSpy.mock.calls.filter((c) => c[0] === 'tw-institutional-daily-sync').length).toBe(1);
    expect(rpcSpy.mock.calls.filter((c) => c[0] === 'enqueue_bsr_backfill').length).toBe(1);
    expect(invokeSpy).toHaveBeenCalledWith('tw-institutional-daily-sync', {
      mode: 'backfill_stock', stock_id: '2330', days: 60,
    });
    expect(rpcSpy).toHaveBeenCalledWith('enqueue_bsr_backfill', { p_stock_id: '2330', p_days: 60 });

    // 尾隨 500ms 不得有 auto 疊加。
    await new Promise((r) => setTimeout(r, 500));
    expect(invokeSpy.mock.calls.filter((c) => c[0] === 'tw-institutional-daily-sync').length).toBe(1);
    expect(rpcSpy.mock.calls.filter((c) => c[0] === 'enqueue_bsr_backfill').length).toBe(1);
  });
});
