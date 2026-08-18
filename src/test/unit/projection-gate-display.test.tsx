/**
 * P0 regression: a gated/fail-closed position must NEVER render as `0 股`.
 *
 * Four cases required by the incident review:
 *   1. missing relation (42P01)  -> masked
 *   2. relation exists but row absent / expert not active -> masked
 *   3. authorized + ready -> real numbers from the database
 *   4. a real quantity=0 position -> literally "0 股" (0 is valid data)
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import UnrealizedTab from '@/pages/_adminPerformance/UnrealizedTab';
import { resolveProjectionStatus, UNAVAILABLE_LABEL, isMaskedRow } from '@/contracts/publicProjection';
import { gatePositionRows } from '@/contracts/publicEconomicContract';
import type { PerfRow } from '@/pages/_adminPerformance/types';

const baseRow: PerfRow = {
  id: 't1',
  instrument: '2330',
  symbol: '2330',
  name: '台積電',
  entry_price: 1000,
  current_price: 1100,
  pnl: 100000,
  pnl_percent: 10,
  quantity: 1,
  quantity_unit: '張',
  base_quantity: 1000,
  status: 'open',
  currency: 'TWD',
  asset_class: 'tw_stock',
};

function renderRows(rows: any[]) {
  return render(
    <UnrealizedTab rows={rows as PerfRow[]} loading={false} totalPnlPercent={null} avgPnlPercent={null} count={rows.length} />,
  );
}

describe('projection gate display contract', () => {
  it('case 1 — missing relation (42P01) masks numbers instead of showing 0 股', () => {
    const status = resolveProjectionStatus(null, { code: '42P01', message: 'relation does not exist' });
    expect(status.showNumbers).toBe(false);
    const gated = gatePositionRows([baseRow as unknown as Record<string, unknown>], status);
    expect(isMaskedRow(gated[0] as any)).toBe(true);
    renderRows(gated);
    expect(screen.getAllByText(UNAVAILABLE_LABEL).length).toBeGreaterThan(0);
    expect(screen.queryByText('0 股')).toBeNull();
    expect(screen.queryByText('0 張')).toBeNull();
  });

  it('case 2 — relation exists but the projection row is absent masks numbers', () => {
    const status = resolveProjectionStatus(null, null);
    expect(status.showNumbers).toBe(false);
    const gated = gatePositionRows([baseRow as unknown as Record<string, unknown>], status);
    renderRows(gated);
    expect(screen.getAllByText(UNAVAILABLE_LABEL).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^0 /)).toBeNull();
  });

  it('case 3 — authorized + ready renders the real database numbers', () => {
    const status = resolveProjectionStatus({ state: 'ready', withheld_count: 0, incomplete_count: 0, manual_review_count: 0 }, null);
    expect(status.showNumbers).toBe(true);
    const gated = gatePositionRows([baseRow as unknown as Record<string, unknown>], status);
    expect(isMaskedRow(gated[0] as any)).toBe(false);
    renderRows(gated);
    expect(screen.getByText('1 張')).toBeInTheDocument();
    expect(screen.queryByText(UNAVAILABLE_LABEL)).toBeNull();
  });

  it('case 4 — a real quantity=0 position still renders 0, not the masked label', () => {
    const status = resolveProjectionStatus({ state: 'ready', withheld_count: 0, incomplete_count: 0, manual_review_count: 0 }, null);
    const zero = { ...baseRow, id: 't0', symbol: '6505', name: '台塑化', quantity: 0, base_quantity: 0 };
    const gated = gatePositionRows([zero as unknown as Record<string, unknown>], status);
    expect(isMaskedRow(gated[0] as any)).toBe(false);
    renderRows(gated);
    expect(screen.getByText(/^0 (股|張)$/)).toBeInTheDocument();
    expect(screen.queryByText(UNAVAILABLE_LABEL)).toBeNull();
  });
});
