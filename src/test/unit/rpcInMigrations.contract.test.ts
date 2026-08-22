/**
 * Stage 0/1 RED→GREEN test — 部署漂移守衛。
 *
 * 硬合約：Edge Function 呼叫的每一支 public RPC，都必須在 `supabase/migrations/`
 * 有 `CREATE (OR REPLACE) FUNCTION` 定義。
 *
 * 事故背景（2026-08）：Stage B 版 `tw-bsr-finmind-sync` 部署到 production，但
 * `bsr_admission_status()` 只存在於 clone 排練腳本 `db/r1/c/SB/001_stage_b.sql`。
 * 結果 worker 每次 fail-closed（HTTP 200 / claimed=0），cron 全綠、背景回補零產出。
 *
 * 兩層強度：
 *   1. gate-specific（bsrAdmissionGate.ts）：zero allowed missing，known-debt 完全無效。
 *   2. 全域 scanner：允許 `scripts/rpc-known-debt.json` 內顯性登記的技術債，
 *      但任何未登記的新 missing 一律 fail，且 debt 數量必須被明示（不得靜默忽略）。
 */
import { describe, it, expect } from 'vitest';
import {
  audit,
  auditGate,
  collectRpcCalls,
  collectDefinedFunctions,
  loadKnownDebt,
} from '../../../scripts/audit-rpc-in-migrations.mjs';

describe('RPC-in-migrations static contract', () => {
  it('gate 契約：bsrAdmissionGate.ts 的 RPC 必須 zero missing', () => {
    const gate = auditGate();
    const lines = gate.missing.map((m) => `public.${m.name}() ← ${m.callers.join(', ')}`);
    expect(lines, `gate RPC 缺定義（known-debt 對 gate 無效）：\n${lines.join('\n')}`).toEqual([]);
  });

  it('gate 契約涵蓋的 RPC 名單就是 bsrAdmissionGate.ts 實際呼叫的兩支', () => {
    expect(auditGate().names).toEqual(['bsr_admission_status', 'bsr_block_and_terminalize_claims']);
  });

  it('全域 scanner：未登記的 missing 必須為 0', () => {
    const { missing } = audit();
    const lines = missing.map((m) => `public.${m.name}() ← ${m.callers.join(', ')}`);
    expect(lines, `部署漂移（未登記）：\n${lines.join('\n')}`).toEqual([]);
  });

  it('全域 scanner：exec_count 是唯一顯性 known debt（debt=1，不得靜默）', () => {
    const { debt } = audit();
    expect(debt.map((d) => d.rpc)).toEqual(['exec_count']);
    expect(debt[0].caller).toBe('supabase/functions/backfill-daily-snapshots/index.ts:203');
    expect(debt[0].discovered).toBe('2026-08-22');
    expect(debt[0].scope_owner).toBeTruthy();
    expect(debt[0].reason).toBeTruthy();
  });

  it('known-debt manifest 不得把 gate 三支列為技術債', () => {
    const { forbidden, byName } = loadKnownDebt();
    for (const n of ['bsr_admission_status', 'bsr_block_and_terminalize_claims', 'bsr_unblock_after_probe']) {
      expect(forbidden.has(n)).toBe(true);
      expect(byName.has(n)).toBe(false);
    }
  });

  it('bsr_unblock_after_probe 的 caller（admin-bsr-admission）也必須被 migrations 覆蓋', () => {
    const calls = collectRpcCalls(['supabase/functions/admin-bsr-admission/index.ts']);
    expect([...calls.keys()]).toContain('bsr_unblock_after_probe');
    expect(collectDefinedFunctions().has('bsr_unblock_after_probe')).toBe(true);
  });

  it('掃描器本身可用：抓得到 bsrAdmissionGate.ts 的 .rpc() 字面量與行號', () => {
    const calls = collectRpcCalls(['supabase/functions/_shared/bsrAdmissionGate.ts']);
    expect([...calls.get('bsr_admission_status')!][0]).toMatch(/bsrAdmissionGate\.ts:\d+$/);
  });
});
