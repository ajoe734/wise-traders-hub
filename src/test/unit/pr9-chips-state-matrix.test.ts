// PR-9: ChipsUIState 完整狀態矩陣測試
// 5 態 × 主要 error kind × circuit state 組合，防止未來新增分支時破功。
import { describe, it, expect } from 'vitest';
import { deriveChipsState } from '@/checkup/hooks/useChipsState';
import type { TwChipsPayload, ChipsError } from '@/checkup/hooks/useTwChipsDetail';

function payload(overrides: Partial<TwChipsPayload> = {}): TwChipsPayload {
  return {
    as_of: '2026-07-25',
    bsr_as_of: '2026-07-25',
    bsr_freshness_status: 'fresh',
    bsr_source: 'rollup',
    as_of_lag_days: 0,
    bsr_sync_status: null,
    readiness: { institutional: { '5': { state: 'ready', have: 5, need: 5 } as any } as any } as any,
    upstream_circuit: undefined,
    ...overrides,
  } as any;
}

describe('PR-9 chips state matrix', () => {
  it('ineligible: chipEligible=false wins over anything', () => {
    const r = deriveChipsState(payload({ bsr_freshness_status: 'fresh' }), null, { chipEligible: false });
    expect(r.state).toBe('ineligible');
  });

  it('ineligible: backend flags unsupported_asset_type', () => {
    const r = deriveChipsState(
      payload({ bsr_freshness_status: 'ineligible' as any, bsr_sync_status: { status: 'ineligible', ineligible_reason: 'unsupported_asset_type' } as any }),
      null, { chipEligible: true });
    expect(r.state).toBe('ineligible');
    expect(r.reason).toContain('ETF');
  });

  it('upstream_outage: circuit finmind_bsr open beats fresh data', () => {
    const r = deriveChipsState(payload({
      upstream_circuit: { any_open: true, sources: { finmind_bsr: { state: 'open', disabled_until: '2999-01-01T00:00:00Z' } } } as any,
    }), null, { chipEligible: true });
    expect(r.state).toBe('upstream_outage');
  });

  it('upstream_outage: server error kind', () => {
    const err: ChipsError = { kind: 'server', message: '500' } as any;
    const r = deriveChipsState(payload(), err, { chipEligible: true });
    expect(r.state).toBe('upstream_outage');
  });

  it('upstream_outage: queue dead', () => {
    const r = deriveChipsState(payload({
      bsr_sync_status: { status: 'dead' } as any,
      bsr_as_of: null as any,
    }), null, { chipEligible: true });
    expect(r.state).toBe('upstream_outage');
  });

  it('filling_new_stock: syncing without any bsr_as_of', () => {
    const r = deriveChipsState(payload({
      bsr_freshness_status: 'syncing',
      bsr_as_of: null as any,
      bsr_sync_status: { status: 'running' } as any,
    }), null, { chipEligible: true });
    expect(r.state).toBe('filling_new_stock');
    expect(r.isPolling).toBe(true);
  });

  it('d1_fallback: lagging with data', () => {
    const r = deriveChipsState(payload({
      bsr_freshness_status: 'lagging',
      bsr_as_of: '2026-07-24',
      as_of_lag_days: 1,
    }), null, { chipEligible: true });
    expect(r.state).toBe('d1_fallback');
    expect(r.isD1Fallback).toBe(true);
  });

  it('d1_fallback: raw_fallback source with lag', () => {
    const r = deriveChipsState(payload({
      bsr_source: 'raw_fallback',
      as_of_lag_days: 1,
    }), null, { chipEligible: true });
    expect(r.state).toBe('d1_fallback');
  });

  it('ready: fresh + no error + no circuit issue', () => {
    const r = deriveChipsState(payload(), null, { chipEligible: true });
    expect(r.state).toBe('ready');
    expect(r.isPolling).toBe(false);
    expect(r.isD1Fallback).toBe(false);
  });

  it('half_open circuit alone does NOT trigger outage (data-driven wins)', () => {
    const r = deriveChipsState(payload({
      upstream_circuit: { any_open: false, sources: { finmind_bsr: { state: 'half_open', disabled_until: null } } } as any,
    }), null, { chipEligible: true });
    expect(r.state).toBe('ready');
  });
});
