import { describe, it, expect } from 'vitest';
import { computeScenario, isDirty } from '@/checkup/components/freecheckup/holdingScenario';

describe('computeScenario', () => {
  it('原始狀態（無 delta、無加碼）：均價 = cost、PnL = (price-cost)/cost', () => {
    const r = computeScenario({ cost: 100, qty: 10, price: 120 });
    expect(r.simAvgCost).toBe(100);
    expect(r.simQty).toBe(10);
    expect(r.simValue).toBe(1200);
    expect(r.simPnlPct).toBeCloseTo(20, 5);
    expect(r.simPnlAbs).toBeCloseTo(200, 5);
  });

  it('加碼 +5 @ 110 → 新均價 (100·10 + 110·5)/15 ≈ 103.33', () => {
    const r = computeScenario({ cost: 100, qty: 10, price: 120, deltaQty: 5, buyMorePrice: 110 });
    expect(r.simAvgCost).toBeCloseTo(103.3333, 3);
    expect(r.simQty).toBe(15);
    expect(r.simValue).toBe(1800);
    expect(r.simPnlPct).toBeCloseTo(((120 - 103.3333) / 103.3333) * 100, 2);
  });

  it('加碼未填價 → 沿用 cost 作為加碼價', () => {
    const r = computeScenario({ cost: 100, qty: 10, price: 120, deltaQty: 5 });
    expect(r.simAvgCost).toBe(100);
    expect(r.simQty).toBe(15);
  });

  it('減碼 -4 → 均價不變、數量遞減', () => {
    const r = computeScenario({ cost: 100, qty: 10, price: 120, deltaQty: -4 });
    expect(r.simAvgCost).toBe(100);
    expect(r.simQty).toBe(6);
    expect(r.simValue).toBe(720);
  });

  it('upside% = (target-price)/price·100', () => {
    const r = computeScenario({ cost: 100, qty: 10, price: 120, target: 150 });
    expect(r.upsidePct).toBeCloseTo(25, 5);
  });

  it('risk:reward = (target-price)/(price-stop)，stop=110 → (150-120)/(120-110)=3', () => {
    const r = computeScenario({ cost: 100, qty: 10, price: 120, target: 150, stopPrice: 110 });
    expect(r.riskReward).toBeCloseTo(3, 5);
    expect(r.riskPct).toBeCloseTo(10, 5);
  });

  it('stop >= price 時 r:r 回 null（避免除零或負值誤導）', () => {
    const r = computeScenario({ cost: 100, qty: 10, price: 120, target: 150, stopPrice: 125 });
    expect(r.riskReward).toBeNull();
  });

  it('缺欄位（cost=0）時 PnL 回 null，不爆 NaN', () => {
    const r = computeScenario({ cost: 0, qty: 10, price: 120 });
    expect(r.simPnlPct).toBeNull();
  });
});

describe('isDirty', () => {
  it('全空 → false', () => {
    expect(isDirty({ cost: 100, qty: 10, price: 120 }, 150)).toBe(false);
  });
  it('target 改動 → true', () => {
    expect(isDirty({ cost: 100, qty: 10, price: 120, target: 160 }, 150)).toBe(true);
  });
  it('delta 非零 → true', () => {
    expect(isDirty({ cost: 100, qty: 10, price: 120, deltaQty: 1 }, 150)).toBe(true);
  });
  it('停損價填入 → true', () => {
    expect(isDirty({ cost: 100, qty: 10, price: 120, stopPrice: 110 }, 150)).toBe(true);
  });
});
