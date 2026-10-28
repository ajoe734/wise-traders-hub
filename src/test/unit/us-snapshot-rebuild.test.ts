import { describe, expect, it } from 'vitest';
import { completedSessionAt, nasdaqAssetClass, parseNasdaqHistory } from '../../../supabase/functions/_shared/usSnapshotRebuild';

const payload = { status: { rCode: 200 }, data: { tradesTable: { rows: [
  { date: '10/27/2026', open: '$73', high: '$74', low: '$70', close: '$72.50', volume: '2,000' },
  { date: '10/26/2026', open: '$72', high: '$73', low: '$71', close: '$71.94', volume: '1,000' },
  { date: '10/23/2026', open: '$71', high: '$72', low: '$70', close: '$71', volume: '900' },
] } } };

describe('US official daily reconstruction', () => {
  it('uses exchange close, OHLC and shares, not adjusted-close or metadata quote', () => {
    const bars = parseNasdaqHistory(payload, '2026-10-27');
    expect(bars[1]).toMatchObject({ trade_date: '2026-10-26', close_price: 71.94, volume: 1000, yesterday_close: 71 });
  });
  it('corrects Oct 27 Taipei capture to Oct 26 completed NY session', () => {
    expect(completedSessionAt('2026-10-27T06:00:04Z', parseNasdaqHistory(payload, '2026-10-27'))?.trade_date).toBe('2026-10-26');
  });
  it('takes latest actual session across weekends and holidays without inventing bars', () => {
    expect(completedSessionAt('2026-10-26T06:00:00Z', parseNasdaqHistory(payload, '2026-10-27'))?.trade_date).toBe('2026-10-23');
  });
  it('excludes unavailable source dates and unsupported options, never substitutes underlying', () => {
    expect(parseNasdaqHistory({ data: null }, '2026-10-27')).toEqual([]);
    expect(completedSessionAt('2026-07-01T06:00:00Z', parseNasdaqHistory(payload, '2026-10-27'))).toBeNull();
    expect(nasdaqAssetClass('LUNR260821C00016000')).toBeNull();
    expect(nasdaqAssetClass('SOXL')).toBe('etf');
  });
  it('does not accept malformed dates, duplicate sessions or invalid OHLCV', () => {
    const invalid = structuredClone(payload); invalid.data.tradesTable.rows[0].low = '$99';
    expect(() => parseNasdaqHistory(invalid, '2026-10-27')).toThrow('Invalid exchange OHLCV');
    const duplicate = structuredClone(payload); duplicate.data.tradesTable.rows.push(duplicate.data.tradesTable.rows[0]);
    expect(() => parseNasdaqHistory(duplicate, '2026-10-27')).toThrow('duplicate');
  });
  it('handles DST and after-close capture using New York, not fixed UTC offset', () => {
    const bars = parseNasdaqHistory(payload, '2026-10-27');
    expect(completedSessionAt('2026-10-27T20:15:00Z', bars)?.trade_date).toBe('2026-10-27');
    expect(completedSessionAt('invalid', bars)).toBeNull();
  });
});