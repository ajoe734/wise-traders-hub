import { describe, it, expect } from 'vitest';
import { calcDailyPnl, isLimitUp, extractSymbol } from '@/lib/schedulerCalc';

describe('1.26 schedulerCalc', () => {
  describe('calcDailyPnl', () => {
    it('returns null when entryPrice is 0 or falsy', () => {
      expect(calcDailyPnl(100, 0)).toBeNull();
      expect(calcDailyPnl(100, NaN)).toBeNull();
    });

    it('returns null when entryPrice is negative', () => {
      expect(calcDailyPnl(100, -1)).toBeNull();
    });

    it('rounds to 2 decimal places', () => {
      // (110 - 100) / 100 = 0.10 → 10.00
      expect(calcDailyPnl(110, 100)).toBe(10);
      // (100.5 - 100) / 100 = 0.005 → 0.50
      expect(calcDailyPnl(100.5, 100)).toBe(0.5);
    });

    it('handles negative pnl', () => {
      expect(calcDailyPnl(90, 100)).toBe(-10);
    });

    it('handles zero pnl', () => {
      expect(calcDailyPnl(100, 100)).toBe(0);
    });
  });

  describe('isLimitUp', () => {
    it('returns false when limitUp is null', () => {
      expect(isLimitUp(100, null)).toBe(false);
    });

    it('returns false when price is null', () => {
      expect(isLimitUp(null, 110)).toBe(false);
    });

    it('returns true when price >= limitUp', () => {
      expect(isLimitUp(110, 110)).toBe(true);
      expect(isLimitUp(115, 110)).toBe(true);
    });

    it('returns false when price < limitUp', () => {
      expect(isLimitUp(109.99, 110)).toBe(false);
    });
  });

  describe('extractSymbol', () => {
    it('extracts the first space-delimited part', () => {
      expect(extractSymbol('2330 台積電')).toBe('2330');
    });

    it('returns the whole string if no space', () => {
      expect(extractSymbol('2330')).toBe('2330');
    });

    it('handles empty string', () => {
      expect(extractSymbol('')).toBe('');
    });

    it('handles undefined safely', () => {
      expect(extractSymbol(undefined as unknown as string)).toBeUndefined();
    });
  });
});
