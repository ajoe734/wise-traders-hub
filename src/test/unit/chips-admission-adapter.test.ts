// PR-10: admitFinmind adapter 測試 —
// v1/v2 RPC 路徑、fail-closed 預設、null payload、borrowed_from 透傳。
//
// 目的：純測試 adapter 決策，不接真實 Supabase。使用手工 mock。

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock kill switch / circuit 永遠允許（測 admission 決策不受這兩個影響時）
vi.mock('../../../supabase/functions/_shared/killSwitch.ts', () => ({
  checkKillSwitch: vi.fn(async () => true),
}));
vi.mock('../../../supabase/functions/_shared/circuitBreaker.ts', () => ({
  checkCircuit: vi.fn(async () => ({ allowed: true })),
}));

// Deno.env stub — 讓 useLegacyAdmit 可控
(globalThis as any).Deno = { env: { get: (_k: string) => undefined } };

import { admitFinmind } from '../../../supabase/functions/_shared/finmindAdmission';

interface Call {
  rpc: string;
  args: Record<string, unknown>;
}

function makeSupa(rpcImpl: (name: string, args: any) => { data?: any; error?: any }) {
  const calls: Call[] = [];
  const ledger: any[] = [];
  return {
    calls,
    ledger,
    rpc(name: string, args: any) {
      calls.push({ rpc: name, args });
      const { data = null, error = null } = rpcImpl(name, args) || {};
      return Promise.resolve({ data, error });
    },
    from(_t: string) {
      return {
        insert: (row: any) => {
          ledger.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  } as any;
}

beforeEach(() => {
  (globalThis as any).Deno.env.get = () => undefined;
});

describe('admitFinmind — adapter 路徑', () => {
  it('預設走 finmind_admit_v2，帶 _allow_borrow=true（interactive）', async () => {
    const supa = makeSupa(() => ({ data: { granted: true, reason: 'ok', remaining: 5 } }));
    const r = await admitFinmind(supa, { pool: 'interactive', kind: 'chips_detail' });
    expect(r.granted).toBe(true);
    expect(supa.calls[0].rpc).toBe('finmind_admit_v2');
    expect(supa.calls[0].args._allow_borrow).toBe(true);
  });

  it('keepwarm 不允許 borrow', async () => {
    const supa = makeSupa(() => ({ data: { granted: true, reason: 'ok' } }));
    await admitFinmind(supa, { pool: 'keepwarm', kind: 'kw' });
    expect(supa.calls[0].args._allow_borrow).toBe(false);
  });

  it('FINMIND_ADMIT_LEGACY=1 → 走 v1 且不帶 _allow_borrow', async () => {
    (globalThis as any).Deno.env.get = (k: string) => (k === 'FINMIND_ADMIT_LEGACY' ? '1' : undefined);
    const supa = makeSupa(() => ({ data: { granted: true, reason: 'ok' } }));
    await admitFinmind(supa, { pool: 'interactive', kind: 'chips' });
    expect(supa.calls[0].rpc).toBe('finmind_admit');
    expect(supa.calls[0].args._allow_borrow).toBeUndefined();
  });

  it('RPC error + 預設 fail-closed → granted=false 並寫 ledger', async () => {
    const supa = makeSupa(() => ({ error: { message: 'boom' } }));
    const r = await admitFinmind(supa, { pool: 'keepwarm', kind: 'kw' });
    expect(r.granted).toBe(false);
    expect(r.reason).toBe('admission_rpc_error');
    expect(supa.ledger[0].granted).toBe(false);
    expect(supa.ledger[0].reason).toBe('admission_rpc_error');
  });

  it('RPC error + failOpen=true → granted=true（明確可容忍才用）', async () => {
    const supa = makeSupa(() => ({ error: { message: 'boom' } }));
    const r = await admitFinmind(supa, { pool: 'backfill', kind: 'bf', failOpen: true });
    expect(r.granted).toBe(true);
  });

  it('RPC 回 { data:null, error:null } → fail-closed（admission_null_payload）', async () => {
    const supa = makeSupa(() => ({ data: null, error: null }));
    const r = await admitFinmind(supa, { pool: 'keepwarm', kind: 'kw' });
    expect(r.granted).toBe(false);
    expect(r.reason).toBe('admission_null_payload');
  });

  it('borrowed_from 透傳到結果', async () => {
    const supa = makeSupa(() => ({ data: { granted: true, reason: 'ok', borrowed_from: 'keepwarm' } }));
    const r = await admitFinmind(supa, { pool: 'interactive', kind: 'chips' });
    expect(r.borrowed_from).toBe('keepwarm');
  });
});
