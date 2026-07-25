// PR-8: FinMind Admission Control 單元測試
// 用 in-memory mock supabase client 驗證 admit 決策矩陣。

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 前必須先 stub circuitBreaker / killSwitch 兩個 shared module
vi.mock('../../../supabase/functions/_shared/circuitBreaker.ts', () => ({
  checkCircuit: vi.fn().mockResolvedValue({ allowed: true, state: 'closed', disabled_until: null }),
}));
vi.mock('../../../supabase/functions/_shared/killSwitch.ts', () => ({
  checkKillSwitch: vi.fn().mockResolvedValue(true),
}));

import { admitFinmind } from '../../../supabase/functions/_shared/finmindAdmission.ts';
import { checkCircuit } from '../../../supabase/functions/_shared/circuitBreaker.ts';
import { checkKillSwitch } from '../../../supabase/functions/_shared/killSwitch.ts';

function makeSupa(rpcImpl: (name: string, args: any) => any) {
  return {
    rpc: vi.fn(async (name: string, args: any) => ({ data: rpcImpl(name, args), error: null })),
    from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ error: null }) })),
  };
}

describe('PR-8 admitFinmind', () => {
  beforeEach(() => {
    vi.mocked(checkCircuit).mockResolvedValue({ allowed: true, state: 'closed', disabled_until: null });
    vi.mocked(checkKillSwitch).mockResolvedValue(true);
  });

  it('grants when quota available, circuit closed, switch on', async () => {
    const supa = makeSupa(() => ({ granted: true, reason: 'ok', remaining: 99 }));
    const r = await admitFinmind(supa, { pool: 'interactive', kind: 'on_demand' });
    expect(r.granted).toBe(true);
    expect(r.reason).toBe('ok');
    expect(r.remaining).toBe(99);
  });

  it('rejects when quota exceeded', async () => {
    const supa = makeSupa(() => ({ granted: false, reason: 'quota_exceeded', remaining: 0 }));
    const r = await admitFinmind(supa, { pool: 'backfill', kind: 'fastlane' });
    expect(r.granted).toBe(false);
    expect(r.reason).toBe('quota_exceeded');
  });

  it('rejects when kill-switch off (does not call RPC)', async () => {
    vi.mocked(checkKillSwitch).mockResolvedValue(false);
    const supa = makeSupa(() => ({ granted: true, reason: 'ok' }));
    const r = await admitFinmind(supa, { pool: 'keepwarm', kind: 'keepwarm_wave1' });
    expect(r.granted).toBe(false);
    expect(r.reason).toBe('kill_switch_off');
    expect(supa.rpc).not.toHaveBeenCalled();
  });

  it('rejects when circuit open (does not call RPC)', async () => {
    vi.mocked(checkCircuit).mockResolvedValue({ allowed: false, state: 'open', disabled_until: '2999-01-01T00:00:00Z' });
    const supa = makeSupa(() => ({ granted: true, reason: 'ok' }));
    const r = await admitFinmind(supa, { pool: 'keepwarm', kind: 'keepwarm_wave1' });
    expect(r.granted).toBe(false);
    expect(r.reason).toBe('circuit_open');
    expect(supa.rpc).not.toHaveBeenCalled();
  });

  it('fails open when RPC errors (does NOT block traffic on infra glitch)', async () => {
    const supa = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'rpc down' } }),
      from: vi.fn(),
    };
    const r = await admitFinmind(supa, { pool: 'interactive', kind: 'on_demand' });
    expect(r.granted).toBe(true);
    expect(r.reason).toBe('admission_error');
  });

  it('honors skipCircuit=true (guardian mode)', async () => {
    vi.mocked(checkCircuit).mockResolvedValue({ allowed: false, state: 'open', disabled_until: null });
    const supa = makeSupa(() => ({ granted: true, reason: 'ok', remaining: 50 }));
    const r = await admitFinmind(supa, { pool: 'keepwarm', kind: 'guardian_probe', skipCircuit: true });
    expect(r.granted).toBe(true);
    expect(supa.rpc).toHaveBeenCalled();
  });

  it('interactive pool exhaustion does not affect keepwarm (independent state)', async () => {
    const budgets = { interactive: 0, keepwarm: 100 };
    const supa = {
      rpc: vi.fn(async (_: string, args: any) => ({
        data: budgets[args._pool as keyof typeof budgets] > 0
          ? { granted: true, reason: 'ok', remaining: budgets[args._pool as keyof typeof budgets]-- }
          : { granted: false, reason: 'quota_exceeded', remaining: 0 },
        error: null,
      })),
      from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ error: null }) })),
    };
    const r1 = await admitFinmind(supa as any, { pool: 'interactive', kind: 'on_demand' });
    const r2 = await admitFinmind(supa as any, { pool: 'keepwarm', kind: 'keepwarm_wave1' });
    expect(r1.granted).toBe(false);
    expect(r2.granted).toBe(true);
  });
});
