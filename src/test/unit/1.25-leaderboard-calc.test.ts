import { describe, it, expect } from 'vitest';
import { calcLeaderboardWinRate } from '@/lib/leaderboardCalc';

describe('1.25 leaderboardCalc', () => {
  describe('calcLeaderboardWinRate', () => {
    it('returns 0 when totalClosed is 0 (zero-division guard)', () => {
      expect(calcLeaderboardWinRate(0, 0)).toBe(0);
      expect(calcLeaderboardWinRate(0, 5)).toBe(0);
    });

    it('returns 0 when totalClosed is negative (defensive)', () => {
      expect(calcLeaderboardWinRate(-1, 0)).toBe(0);
    });

    it('rounds to 1 decimal place', () => {
      // 1/3 = 33.333… → 33.3
      expect(calcLeaderboardWinRate(3, 1)).toBe(33.3);
      // 2/3 = 66.666… → 66.7
      expect(calcLeaderboardWinRate(3, 2)).toBe(66.7);
    });

    it('returns 100 for all wins', () => {
      expect(calcLeaderboardWinRate(10, 10)).toBe(100);
    });

    it('returns 0 for all losses', () => {
      expect(calcLeaderboardWinRate(10, 0)).toBe(0);
    });

    it('handles fractional rounding correctly', () => {
      // 7/8 = 87.5 → 87.5
      expect(calcLeaderboardWinRate(8, 7)).toBe(87.5);
      // 1/8 = 12.5 → 12.5
      expect(calcLeaderboardWinRate(8, 1)).toBe(12.5);
    });
  });
});
