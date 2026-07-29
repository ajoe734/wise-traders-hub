import { describe, it, expect } from 'vitest';
import { marketPhase, detectHoldingMarket } from '../marketClock';

describe('marketPhase — TW', () => {
  it('open at 10:00 TPE weekday', () => {
    // 2026-06-02 (Tue) 10:00 TPE = 02:00 UTC
    const p = marketPhase('TW', new Date('2026-06-02T02:00:00Z'));
    expect(p.phase).toBe('open');
    expect(p.hasSettledSnapshot).toBe(false);
    expect(p.marketDate).toBe('2026-06-02');
  });

  it('closed_post but pre-settle at 13:40 TPE (before 14:05)', () => {
    // 05:40 UTC = 13:40 TPE
    const p = marketPhase('TW', new Date('2026-06-02T05:40:00Z'));
    expect(p.phase).toBe('closed_post');
    expect(p.hasSettledSnapshot).toBe(false);
  });

  it('settled at 14:10 TPE (after 14:05)', () => {
    const p = marketPhase('TW', new Date('2026-06-02T06:10:00Z'));
    expect(p.phase).toBe('closed_post');
    expect(p.hasSettledSnapshot).toBe(true);
  });

  it('weekend Sat → no snapshot', () => {
    const p = marketPhase('TW', new Date('2026-06-06T06:00:00Z'));
    expect(p.hasSettledSnapshot).toBe(false);
    expect(p.isWeekend).toBe(true);
  });
});

describe('marketPhase — US', () => {
  it('settled at 16:15 ET (after 10min delay)', () => {
    // 2026-06-02 Tue 16:15 EDT = 20:15 UTC
    const p = marketPhase('US', new Date('2026-06-02T20:15:00Z'));
    expect(p.phase).toBe('closed_post');
    expect(p.hasSettledSnapshot).toBe(true);
  });

  it('not settled at 16:05 ET (equal to close+5)', () => {
    const p = marketPhase('US', new Date('2026-06-02T20:05:00Z'));
    expect(p.hasSettledSnapshot).toBe(false);
  });
});

describe('marketPhase — CRYPTO always open', () => {
  it('Sunday 03:00 UTC still open', () => {
    const p = marketPhase('CRYPTO', new Date('2026-06-07T03:00:00Z'));
    expect(p.phase).toBe('open');
    expect(p.isWeekend).toBe(true);
  });
});

describe('detectHoldingMarket', () => {
  it('asset_class us_option wins', () => {
    expect(detectHoldingMarket({ asset_class: 'us_option', code: '2330' })).toBe('US_OPTION');
  });
  it('numeric TW code fallback', () => {
    expect(detectHoldingMarket({ code: '2330' })).toBe('TW');
  });
  it('alphabetic → US fallback', () => {
    expect(detectHoldingMarket({ symbol: 'AAPL' })).toBe('US');
  });
});
