/**
 * SIGNAL_MATH_CONTRACT_V1 — TS 端 contract 測試。
 *
 * 規則：src/lib/signalTradeLogic.ts 的 applySignalMathVector 必須對
 * src/lib/signalMath.contract.json 的每一筆 vector 產生逐值一致的結果；
 * 同一份 JSON 也由 db/p0-signal-math/090_scenarios.sql 的 SQL 鏡像函式執行，
 * 兩邊結果必須完全一致（不得各寫各的期望值）。
 */
import { describe, expect, it } from 'vitest';
import contract from '@/lib/signalMath.contract.json';
import { applySignalMathVector } from '@/lib/signalTradeLogic';

interface Vector {
  id: string;
  action: string;
  price: number;
  quantity: number;
  unit: string;
  priorQtyShares: number;
  priorAvg: number;
  expected: {
    shares: number;
    effectiveSellShares?: number;
    cashDelta: number;
    newQty: number;
    newAvg: number;
    positionCost?: number;
    realizedPnl?: number;
    pnlPercent?: number;
  };
}

describe('SIGNAL_MATH_CONTRACT_V1 — applySignalMathVector vs contract vectors', () => {
  it('contract 檔版本正確且至少 12 筆向量', () => {
    expect(contract.version).toBe('SIGNAL_MATH_CONTRACT_V1');
    expect(contract.vectors.length).toBeGreaterThanOrEqual(12);
  });

  for (const v of contract.vectors as unknown as Vector[]) {
    it(`${v.id}`, () => {
      const r = applySignalMathVector({
        action: v.action,
        price: v.price,
        quantity: v.quantity,
        unit: v.unit,
        priorQtyShares: v.priorQtyShares,
        priorAvg: v.priorAvg,
      });
      const e = v.expected;
      expect(r.shares, 'shares').toBe(e.shares);
      if (e.effectiveSellShares !== undefined) {
        expect(r.effectiveShares, 'effectiveShares').toBe(e.effectiveSellShares);
      }
      expect(r.cashDelta, 'cashDelta').toBe(e.cashDelta);
      expect(r.newQty, 'newQty').toBe(e.newQty);
      expect(r.newAvg, 'newAvg').toBe(e.newAvg);
      if (e.positionCost !== undefined) expect(r.positionCost, 'positionCost').toBe(e.positionCost);
      if (e.realizedPnl !== undefined) expect(r.realizedPnl, 'realizedPnl').toBe(e.realizedPnl);
      if (e.pnlPercent !== undefined) expect(r.pnlPercent, 'pnlPercent').toBe(e.pnlPercent);
    });
  }

  it('exit 絕不得用成本價釋放現金（6706 口徑：143×1000=143000，不是 123×1000）', () => {
    const r = applySignalMathVector({
      action: 'exit', price: 143, quantity: 1, unit: '張',
      priorQtyShares: 1000, priorAvg: 123,
    });
    expect(r.cashDelta).toBe(143000);
    expect(r.realizedPnl).toBe(20000);
  });

  it('00708L 口徑：2 張只換算一次成 2000 股，成本 155400，不得 1000 倍', () => {
    const r = applySignalMathVector({
      action: 'buy', price: 77.7, quantity: 2, unit: '張',
      priorQtyShares: 0, priorAvg: 0,
    });
    expect(r.shares).toBe(2000);
    expect(r.positionCost).toBe(155400);
    expect(r.cashDelta).toBe(-155400);
  });
});
