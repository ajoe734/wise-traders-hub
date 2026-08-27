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
