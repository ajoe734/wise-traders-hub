// PR-6 · useChipsState 5 態機單元測試
import { describe, it, expect } from 'vitest';
import { deriveChipsState } from '@/checkup/hooks/useChipsState';
import type { TwChipsPayload } from '@/checkup/hooks/useTwChipsDetail';

const base = (over: Partial<TwChipsPayload> = {}): TwChipsPayload => ({
  stock_id: '2330',
  as_of: '2026-07-24',
  as_of_lag_days: 0,
  institutional: { d1: null, d5: null, d20: null, d60: null },
  bsr: { d5: null, d20: null, d60: null },
  bsr_as_of: '2026-07-24',
  bsr_as_of_lag_days: 0,
  bsr_source: 'rollup',
  bsr_freshness_status: 'fresh',
  source: 'test',
  fetched_at: new Date().toISOString(),
  ...over,
});

describe('deriveChipsState — 5 state machine', () => {
  it('ineligible when chipEligible=false (ETF/warrant)', () => {
    const r = deriveChipsState(null, null, { chipEligible: false });
    expect(r.state).toBe('ineligible');
    expect(r.subState.ineligible_reason).toBe('not_common_stock');
  });

  it('ineligible when backend flags unsupported_asset_type', () => {
    const r = deriveChipsState(
      base({ bsr_freshness_status: 'ineligible', bsr_sync_status: { eligible: false, ineligible_reason: 'unsupported_asset_type', queued: false, status: 'ineligible', next_run_at: null, attempts: 0, max_attempts: 0, error_code: null, retryable: false } }),
      null, { chipEligible: true },
    );
    expect(r.state).toBe('ineligible');
    expect(r.reason).toContain('ETF');
  });

  it('upstream_outage when queue is dead', () => {
    const r = deriveChipsState(
      base({ bsr_sync_status: { eligible: true, ineligible_reason: null, queued: true, status: 'dead', next_run_at: null, attempts: 5, max_attempts: 5, error_code: 'x', retryable: false } }),
      null, { chipEligible: true },
    );
    expect(r.state).toBe('upstream_outage');
  });

  it('upstream_outage when server 5xx', () => {
    const r = deriveChipsState(
      null,
      { kind: 'server', status: 502, message: 'x', reason: 'x' },
      { chipEligible: true },
    );
    expect(r.state).toBe('upstream_outage');
  });

  it('upstream_outage when institutional d5 upstream_exhausted', () => {
    const r = deriveChipsState(
      base({ readiness: { institutional: { '5': { window_days: 5, state: 'upstream_exhausted', have: 0, need: 5, oldest_available: null, newest_available: null, detail: '' }, '20': null as any, '60': null as any }, bsr_concentration: { '5': null as any, '20': null as any, '60': null as any } } }),
      null, { chipEligible: true },
    );
    expect(r.state).toBe('upstream_outage');
  });

  it('filling_new_stock when queue pending and no bsr_as_of', () => {
    const r = deriveChipsState(
      base({ bsr_as_of: null, bsr_freshness_status: 'syncing', bsr_sync_status: { eligible: true, ineligible_reason: null, queued: true, status: 'pending', next_run_at: null, attempts: 0, max_attempts: 5, error_code: null, retryable: true } }),
      null, { chipEligible: true },
    );
    expect(r.state).toBe('filling_new_stock');
    expect(r.isPolling).toBe(true);
  });

  it('filling_new_stock when queue running', () => {
    const r = deriveChipsState(
      base({ bsr_as_of: null, bsr_freshness_status: 'syncing', bsr_sync_status: { eligible: true, ineligible_reason: null, queued: true, status: 'running', next_run_at: null, attempts: 1, max_attempts: 5, error_code: null, retryable: true } }),
      null, { chipEligible: true },
    );
    expect(r.state).toBe('filling_new_stock');
    expect(r.reason).toContain('分點');
  });

  it('d1_fallback when bsr_source=raw_fallback', () => {
    const r = deriveChipsState(
      base({ bsr_source: 'raw_fallback', as_of_lag_days: 1 }),
      null, { chipEligible: true },
    );
    expect(r.state).toBe('d1_fallback');
    expect(r.isD1Fallback).toBe(true);
  });

  it('d1_fallback when bsr_freshness=lagging', () => {
    const r = deriveChipsState(
      base({ bsr_freshness_status: 'lagging', as_of_lag_days: 1 }),
      null, { chipEligible: true },
    );
    expect(r.state).toBe('d1_fallback');
  });

  it('ready when fresh and lag=0', () => {
    const r = deriveChipsState(base(), null, { chipEligible: true });
    expect(r.state).toBe('ready');
    expect(r.isPolling).toBe(false);
    expect(r.isD1Fallback).toBe(false);
  });

  it('priority: ineligible beats outage/filling', () => {
    const r = deriveChipsState(
      base({ bsr_freshness_status: 'ineligible', bsr_sync_status: { eligible: false, ineligible_reason: 'unsupported_asset_type', queued: false, status: 'dead', next_run_at: null, attempts: 5, max_attempts: 5, error_code: 'x', retryable: false } }),
      { kind: 'server', status: 500, message: 'x', reason: 'x' },
      { chipEligible: false },
    );
    expect(r.state).toBe('ineligible');
  });
});
