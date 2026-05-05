import { describe, it, expect } from 'vitest';
import {
  calcWeightedAvgPrice,
  calcPnlPercent,
  reverseWeightedAvgPrice,
  calcSellQty,
  simulateCashAfterTrades,
} from '@/lib/signalTradeLogic';

describe('1.27 signalTradeLogic', () => {
  describe('calcWeightedAvgPrice', () => {
    it('computes weighted average for ADD operation', () => {
      // 100 @ 10 + 100 @ 20 = (1000 + 2000) / 200 = 15.00
      expect(calcWeightedAvgPrice(100, 10, 100, 20)).toBe(15);
    });

    it('rounds to 2 decimals (mirrors SQL ROUND)', () => {
      // 1 @ 10 + 2 @ 11 = (10 + 22) / 3 = 10.6666… → 10.67
      expect(calcWeightedAvgPrice(1, 10, 2, 11)).toBe(10.67);
    });

    it('falls back to existingPrice when totalQty is 0', () => {
      expect(calcWeightedAvgPrice(0, 50, 0, 0)).toBe(50);
    });
  });

  describe('calcPnlPercent', () => {
    it('returns 0 when entryPrice is 0', () => {
      expect(calcPnlPercent(0, 100)).toBe(0);
    });

    it('returns 0 when entryPrice is negative', () => {
      expect(calcPnlPercent(-1, 100)).toBe(0);
    });

    it('rounds to 2 decimals', () => {
      // (110 - 100) / 100 * 100 = 10
      expect(calcPnlPercent(100, 110)).toBe(10);
      // (101 - 100) / 100 * 100 = 1
      expect(calcPnlPercent(100, 101)).toBe(1);
    });

    it('handles negative pnl', () => {
      expect(calcPnlPercent(100, 90)).toBe(-10);
    });
  });

  describe('reverseWeightedAvgPrice', () => {
    it('reverses an ADD operation', () => {
      // open: 200 @ 15 ; remove: 100 @ 20
      // (200*15 - 100*20) / (200-100) = (3000 - 2000) / 100 = 10
      expect(reverseWeightedAvgPrice(200, 15, 100, 20)).toBe(10);
    });

    it('falls back to openEntry when newQty <= 0', () => {
      expect(reverseWeightedAvgPrice(100, 15, 100, 20)).toBe(15);
      expect(reverseWeightedAvgPrice(100, 15, 200, 20)).toBe(15);
    });
  });

  describe('calcSellQty', () => {
    it('uses signalQty when smaller than existing', () => {
      expect(calcSellQty(50, 100)).toBe(50);
    });

    it('caps at existingQty when signalQty exceeds it', () => {
      expect(calcSellQty(150, 100)).toBe(100);
    });

    it('uses existingQty when signalQty is null', () => {
      expect(calcSellQty(null, 100)).toBe(100);
    });
  });
});
