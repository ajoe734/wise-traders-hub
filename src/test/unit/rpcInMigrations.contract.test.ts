/**
 * Stage 0 RED test — 部署漂移守衛。
 *
 * 硬合約：Edge Function 呼叫的每一支 public RPC，都必須在 `supabase/migrations/`
 * 有 `CREATE (OR REPLACE) FUNCTION` 定義。
 *
 * 事故背景（2026-08）：Stage B 版 `tw-bsr-finmind-sync` 部署到 production，但
 * `bsr_admission_status()` 只存在於 clone 排練腳本 `db/r1/c/SB/001_stage_b.sql`。
 * 結果 worker 每次 fail-closed（HTTP 200 / claimed=0），cron 全綠、背景回補零產出。
 */
import { describe, it, expect } from 'vitest';
import { audit, collectRpcCalls, collectDefinedFunctions } from '../../../scripts/audit-rpc-in-migrations.mjs';

describe('RPC-in-migrations static contract', () => {
  it('每一支 edge function 呼叫的 RPC 都要在 supabase/migrations/ 有定義', () => {
    const { missing } = audit();
    const lines = missing.map((m) => `public.${m.name}() ← ${m.callers.join(', ')}`);
    expect(lines, `部署漂移：以下 RPC 只存在於已部署的 edge function，migrations 沒有定義\n${lines.join('\n')}`).toEqual([]);
  });

  it('bsrAdmissionGate.ts 呼叫的 gate RPC 必須被 migrations 覆蓋', () => {
    const defined = collectDefinedFunctions();
    expect(defined.has('bsr_admission_status')).toBe(true);
    expect(defined.has('bsr_block_and_terminalize_claims')).toBe(true);
  });

  it('掃描器本身可用：確實抓得到 bsrAdmissionGate.ts 的 .rpc() 字面量', () => {
    const calls = collectRpcCalls(['supabase/functions/_shared/bsrAdmissionGate.ts']);
    expect([...calls.keys()].sort()).toEqual(['bsr_admission_status', 'bsr_block_and_terminalize_claims']);
  });
});
