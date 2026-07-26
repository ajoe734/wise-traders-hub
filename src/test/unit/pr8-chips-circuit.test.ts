import { describe, it, expect } from 'vitest';
import { deriveChipsState } from '@/checkup/hooks/useChipsState';
import { getInstReadiness } from '@/checkup/components/freecheckup/ChipsSection';
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

describe('ChipsSection summary: readiness-driven partial display', () => {
  it('shows value with coverage when readiness is filling (6/60)', () => {
    const p = basePayload({
      institutional: {
        d1: null, d5: null, d20: null,
        d60: { foreign_net: -9388, trust_net: 1200, dealer_net: 500, days_covered: 6 },
      },
      readiness: {
        institutional: {
          '5': { state: 'filling', have: 3, need: 5 },
          '20': { state: 'filling', have: 6, need: 20 },
          '60': { state: 'filling', have: 6, need: 60 },
        },
        bsr_concentration: {
          '5': { state: 'ready', have: 5, need: 5 },
        },
      },
    } as TwChipsPayload);
    const rd = getInstReadiness(p, 'd60');
    expect(rd.state).toBe('filling');
    expect(rd.have).toBe(6);
    expect(rd.need).toBe(60);
    expect(rd.partial).toBe(true);
  });

  it('trusts readiness state over days_covered when ready', () => {
    const p = basePayload({
      institutional: {
        d1: null, d5: null, d20: null,
        d60: { foreign_net: -1000, trust_net: 0, dealer_net: 0, days_covered: 45 },
      },
      readiness: {
        institutional: {
          '5': { state: 'ready', have: 5, need: 5 },
          '20': { state: 'ready', have: 20, need: 20 },
          '60': { state: 'ready', have: 60, need: 60 },
        },
        bsr_concentration: { '5': { state: 'ready', have: 5, need: 5 } },
      },
    } as TwChipsPayload);
    const rd = getInstReadiness(p, 'd60');
    expect(rd.state).toBe('ready');
    expect(rd.partial).toBe(false);
  });

  it('d1 window uses local days_covered fallback', () => {
    const p = basePayload({
      institutional: {
        d5: null, d20: null, d60: null,
        d1: { foreign_net: 100, trust_net: 0, dealer_net: 0, days_covered: 1 },
      },
    } as TwChipsPayload);
    expect(getInstReadiness(p, 'd1')).toMatchObject({ state: 'ready', have: 1, need: 1 });
  });
});
