import { describe, it, expect } from 'vitest';
import {
  resolveProjectionStatus,
  canExportFactsheet,
  REVIEW_BADGE,
  REVIEW_NOTE,
} from './publicProjection';
import {
  gatePerformance,
  gatePositionRows,
  gateCapital,
  gateSeries,
  gateSignalEconomics,
  isPubliclyVisible,
  EMBARGO_DAYS,
} from './publicEconomicContract';
import {
  isPubliclyVisible as edgeVisible,
  stripEconomicFacts,
} from '../../supabase/functions/_shared/publicEconomicContract';

/** The seven states the consumer closure must cover. */
const STATES = {
  ready: resolveProjectionStatus({ state: 'ready' }),
  // 6515 穎崴 — drift under adjudication, auto-correction forbidden
  manual_review_6515: resolveProjectionStatus({ state: 'manual_review' }),
  // valuation incomplete because no historical FX rate exists
  fx_incomplete: resolveProjectionStatus({ state: 'incomplete' }),
  // TW warrant with no trusted multiplier → unsupported derivative
  warrant_incomplete: resolveProjectionStatus({ state: 'withheld' }),
  // US option combo missing a leg quote
  option_combo_incomplete: resolveProjectionStatus({ incomplete: true }),
  no_projection: resolveProjectionStatus({ absent: true }),
  error: resolveProjectionStatus({ failed: true }),
} as const;

const NOT_READY = [
  'manual_review_6515',
  'fx_incomplete',
  'warrant_incomplete',
  'option_combo_incomplete',
] as const;

const PERF = {
  total_trades: 12, win_rate: 50, max_drawdown: -10, profit_factor: 1.5,
  avg_hold_days: 3, avg_pnl_pct: 10, avg_pnl_amount: 50, return_1y: 0,
  current_asset: 1_000_000, starting_capital: 1_000_000,
  realized_pnl_amount: 0, unrealized_pnl_amount: NaN, total_return_pct: 50,
};

const FORBIDDEN_RENDERS = [10, 50, 0];

describe('publicProjection state resolution', () => {
  it('maps every scenario to the expected state', () => {
    expect(STATES.ready.state).toBe('ready');
    expect(STATES.manual_review_6515.state).toBe('manual_review');
    expect(STATES.fx_incomplete.state).toBe('incomplete');
    expect(STATES.warrant_incomplete.state).toBe('withheld');
    expect(STATES.option_combo_incomplete.state).toBe('incomplete');
    expect(STATES.no_projection.state).toBe('no_projection');
    expect(STATES.error.state).toBe('error');
  });

  it('shows the public-safe copy only for not-ready states', () => {
    for (const k of NOT_READY) {
      expect(STATES[k].showReviewNotice).toBe(true);
      expect(STATES[k].badge).toBe(REVIEW_BADGE);
      expect(STATES[k].note).toBe(REVIEW_NOTE);
      expect(STATES[k].showNumbers).toBe(false);
    }
    expect(STATES.ready.badge).toBeNull();
  });

  it('fails closed on an unknown state string', () => {
    expect(resolveProjectionStatus({ state: 'something_new' }).showNumbers).toBe(false);
  });
});

describe('gatePerformance', () => {
  it('passes finite numbers through when ready and drops NaN', () => {
    const g = gatePerformance(PERF, STATES.ready)!;
    expect(g.total_return_pct).toBe(50);
    expect(g.unrealized_pnl_amount).toBeNull(); // NaN never leaks
  });

  it.each(NOT_READY)('emits no number at all for %s', (key) => {
    const g = gatePerformance(PERF, STATES[key])!;
    for (const v of Object.values(g)) {
      expect(v).toBeNull();
      expect(FORBIDDEN_RENDERS).not.toContain(v as unknown as number);
    }
  });

  it('legacy path only for an observed no_projection; an error fails closed', () => {
    expect(gatePerformance(PERF, STATES.no_projection)!.total_return_pct).toBe(50);
    // R1-P: a failed read must never surface legacy numbers.
    expect(gatePerformance(PERF, STATES.error)!.total_return_pct).toBeNull();
    expect(gatePerformance(null, STATES.ready)).toBeNull();
  });
});

describe('gatePositionRows / gateCapital / gateSeries', () => {
  const rows = [{ symbol: '6515', quantity: 10, base_quantity: 50, pnl: 0, pnl_percent: 0, entry_price: 1 }];

  it('strips every figure from a 6515 manual-review row but keeps identity', () => {
    const [r] = gatePositionRows(rows, STATES.manual_review_6515);
    expect(r.symbol).toBe('6515');
    expect(r.quantity).toBeNull();
    expect(r.base_quantity).toBeNull();
    expect(r.pnl).toBeNull();
    expect(r.pnl_percent).toBeNull();
    expect(r.entry_price).toBeNull();
    expect(r.under_review).toBe(true);
  });

  it('never returns a flat zero series or a NAV for a withheld scope', () => {
    expect(gateSeries([{ label: 'w1', returnPct: 0 }], STATES.warrant_incomplete)).toEqual([]);
    expect(gateCapital({ current_asset: 0 }, STATES.warrant_incomplete)).toBeNull();
    expect(gateCapital({ current_asset: 100 }, STATES.ready)).not.toBeNull();
  });
});

describe('gateSignalEconomics', () => {
  it('keeps editorial text but removes price/quantity for an incomplete FX scope', () => {
    const [s] = gateSignalEconomics(
      [{ id: 'a', reason_summary: '看多', price_hint: 100, quantity: 10 }],
      STATES.fx_incomplete,
    );
    expect(s.reason_summary).toBe('看多');
    expect(s.price_hint).toBeNull();
    expect(s.quantity).toBeNull();
    expect((s as Record<string, unknown>).under_review).toBe(true);
  });
});

describe('export / factsheet gate', () => {
  it.each(NOT_READY)('forbids the factsheet for %s', (key) => {
    expect(canExportFactsheet(STATES[key])).toBe(false);
  });
  it('allows it for ready and pre-cutover legacy', () => {
    expect(canExportFactsheet(STATES.ready)).toBe(true);
    expect(canExportFactsheet(STATES.no_projection)).toBe(true);
  });
});

describe('T+7 embargo predicate (client and edge mirrors agree)', () => {
  const now = new Date('2026-08-17T00:00:00Z');
  const inside = new Date(now.getTime() - 3 * 86_400_000).toISOString();
  const outside = new Date(now.getTime() - (EMBARGO_DAYS + 1) * 86_400_000).toISOString();

  it('hides an effect that is still embargoed', () => {
    expect(isPubliclyVisible(inside, now)).toBe(false);
    expect(edgeVisible(inside, now)).toBe(false);
  });
  it('releases it once T+7 elapsed', () => {
    expect(isPubliclyVisible(outside, now)).toBe(true);
    expect(edgeVisible(outside, now)).toBe(true);
  });
  it('fails closed on missing / unparsable timestamps', () => {
    expect(isPubliclyVisible(null, now)).toBe(false);
    expect(edgeVisible('not-a-date', now)).toBe(false);
  });
});

describe('OG metadata never carries economic facts', () => {
  it('strips every forbidden field', () => {
    const stripped = stripEconomicFacts({
      id: 'x', instrument: '2330 台積電', price_hint: 1000, total_return_pct: 50, quantity: 10,
    }) as Record<string, unknown>;
    expect(stripped.instrument).toBe('2330 台積電');
    expect('price_hint' in stripped).toBe(false);
    expect('total_return_pct' in stripped).toBe(false);
    expect('quantity' in stripped).toBe(false);
  });
});
