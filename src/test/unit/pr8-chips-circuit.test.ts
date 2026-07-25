import { describe, it, expect } from 'vitest';
import { deriveChipsState } from '@/checkup/hooks/useChipsState';
import type { TwChipsPayload } from '@/checkup/hooks/useTwChipsDetail';

function basePayload(overrides: Partial<TwChipsPayload> = {}): TwChipsPayload {
  return {
    stock_id: '2330',
    as_of: '2026-07-24',
    institutional: { d1: null, d5: null, d20: null, d60: null },
    bsr: { d5: null, d20: null, d60: null },
    bsr_as_of: '2026-07-24',
    bsr_freshness_status: 'fresh',
    source: 'TWSE',
    fetched_at: new Date().toISOString(),
    ...overrides,
  } as TwChipsPayload;
}

describe('PR-8 useChipsState: upstream circuit propagation', () => {
  it('circuit open on finmind_bsr forces upstream_outage even if data looks fresh', () => {
    const p = basePayload({
      upstream_circuit: {
        any_open: true,
        sources: {
          finmind_bsr: {
            state: 'open',
            disabled_until: '2026-07-25T02:00:00.000Z',
            consecutive_failures: 5,
            last_error_code: 'http_500',
          },
        },
      },
    });
    const r = deriveChipsState(p, null, { chipEligible: true });
    expect(r.state).toBe('upstream_outage');
    expect(r.reason).toMatch(/熔斷中/);
    expect(r.reason).toMatch(/分點/);
  });

  it('circuit open on twse_t86 names 三大法人 in reason', () => {
    const p = basePayload({
      upstream_circuit: {
        any_open: true,
        sources: {
          twse_t86: {
            state: 'open',
            disabled_until: null,
            consecutive_failures: 6,
            last_error_code: 'timeout',
          },
        },
      },
    });
    const r = deriveChipsState(p, null, { chipEligible: true });
    expect(r.state).toBe('upstream_outage');
    expect(r.reason).toMatch(/三大法人|熔斷/);
  });

  it('half_open does not force outage (data-driven path wins)', () => {
    const p = basePayload({
      upstream_circuit: {
        any_open: false,
        sources: {
          finmind_bsr: {
            state: 'half_open',
            disabled_until: null,
            consecutive_failures: 5,
            last_error_code: null,
          },
        },
      },
    });
    const r = deriveChipsState(p, null, { chipEligible: true });
    expect(r.state).toBe('ready');
  });

  it('missing upstream_circuit is backward compatible', () => {
    const r = deriveChipsState(basePayload(), null, { chipEligible: true });
    expect(r.state).toBe('ready');
  });
});
