import { describe, it, expect } from 'vitest';
import { buildImportCandidates, candidateToTrade, mergeImport, isImportable } from '../journalImport';
import { emptyTrade } from '@/pages/_signalEditor/types';

const C = 'conn-1';
const row = (symbol: string | null, quantity: number, extra: Partial<any> = {}) => ({
  connection_id: C, symbol, name: `${symbol} Inc`, security_type: 'equity', quantity, as_of: '2026-11-17', review_status: 'confirmed', ...extra,
});
const ledger = [{ symbol: 'SBSI', quantity: 200 }, { symbol: 'AAPL', quantity: 5 }];

describe('Plaid snapshot → journal import', () => {
  it('unconfirmed drafts are never offered', () => {
    const c = buildImportCandidates([row('EWZ', 5, { review_status: 'draft' })], [], [], 'us_stock');
    expect(c).toEqual([]);
  });

  it('classifies against the existing ledger: new, diff, match, ledger_only', () => {
    const c = buildImportCandidates([row('EWZ', 5, { security_type: 'etf' }), row('SBSI', 213), row('AAPL', 5)], ledger, [], 'us_stock');
    const by = Object.fromEntries(c.map((x) => [x.symbol, x]));
    expect(by.EWZ).toMatchObject({ status: 'new', gap: 5, ledgerQty: 0 });
    expect(by.SBSI).toMatchObject({ status: 'diff', gap: 13, ledgerQty: 200 });
    expect(by.AAPL.status).toBe('match');
    const l = buildImportCandidates([row('EWZ', 5)], ledger, [], 'us_stock');
    expect(l.find((x) => x.symbol === 'SBSI')).toMatchObject({ status: 'ledger_only', gap: -200 });
    expect(isImportable(l.find((x) => x.symbol === 'SBSI')!)).toBe(false);
  });

  it('rejects options, funds without valid ticker, missing symbol and non-US ledgers', () => {
    const c = buildImportCandidates([
      row('NFLX180201C00355000', 10000, { security_type: 'derivative' }), row(null, 21.5), row('MIPTX', 23.5, { security_type: 'mutual fund' }),
    ], [], [], 'us_stock');
    expect(c.every((x) => x.status === 'unsupported')).toBe(true);
    expect(buildImportCandidates([row('EWZ', 5)], [], [], 'tw_stock')[0].status).toBe('unsupported');
  });

  it('pre-fills symbol/name/|gap| only — never action, price or reasons', () => {
    const [c] = buildImportCandidates([row('SBSI', 213)], ledger, [], 'us_stock');
    const t = candidateToTrade(c, 'us_stock');
    expect(t).toMatchObject({ stockCode: 'SBSI', quantity: '13', action: '', priceHint: '', reasonSummary: '', quantityUnit: '股' });
    expect(t.brokerageSourceKey).toBe(`plaid:${C}:SBSI:2026-11-17`);
  });

  it('re-import is idempotent and respects rows the teacher already typed', () => {
    const snap = [row('EWZ', 5, { security_type: 'etf' }), row('SBSI', 213)];
    const first = mergeImport([emptyTrade('us_stock')], buildImportCandidates(snap, ledger, [], 'us_stock'), 'us_stock');
    expect(first.map((t) => t.stockCode)).toEqual(['EWZ', 'SBSI']);
    const again = buildImportCandidates(snap, ledger, first, 'us_stock');
    expect(again.filter(isImportable)).toEqual([]);
    expect(mergeImport(first, again, 'us_stock')).toBe(first);
    const typed = [{ ...emptyTrade('us_stock'), stockCode: 'ewz', action: 'buy' as const }];
    expect(buildImportCandidates(snap, ledger, typed, 'us_stock').find((x) => x.symbol === 'EWZ')!.status).toBe('in_editor');
  });

  it('sums multiple broker lots of the same symbol', () => {
    const c = buildImportCandidates([row('EWZ', 2, { security_type: 'etf' }), row('EWZ', 3, { security_type: 'etf' })], [], [], 'us_stock');
    expect(c).toHaveLength(1);
    expect(c[0].snapshotQty).toBe(5);
  });
});
