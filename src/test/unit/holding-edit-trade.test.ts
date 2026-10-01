import { describe, expect, it } from 'vitest';
import { buildHoldingEditTrade } from '@/checkup/lib/holdingEditTrade';
import { applyTradeEntryToHoldings } from '@/checkup/lib/holdings';
import { holdingsValueKeyShort } from '@/checkup/lib/holdingsSort';

const holding = { code: '6213', name: '聯茂', qty: 1000, cost: 80, price: 100 };
const now = new Date('2026-09-21T04:00:00Z');

describe('持倉編輯記真實成交', () => {
  it('賣出只扣股數並保留市價，立刻改變產業與估值的持倉 key', () => {
    const result = buildHoldingEditTrade({ holding, targetQty: 500, targetCost: 80, executionPrice: 200, now });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry).toMatchObject({ action: '賣出', qty: 500, price: 200, priceSource: 'manual', code: '6213' });
    const next = applyTradeEntryToHoldings([holding], result.entry);
    expect(next[0].qty).toBe(500);
    expect(next[0].price).toBe(100);
    expect(next[0].value).toBe(50000);
    expect(holdingsValueKeyShort(next)).not.toBe(holdingsValueKeyShort([holding]));
  });

  it('加碼用真成交價推算新成本，卻不把成交價當市場報價', () => {
    const result = buildHoldingEditTrade({ holding, targetQty: 2000, targetCost: 90, executionPrice: 100, now });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = applyTradeEntryToHoldings([holding], result.entry);
    expect(next[0]).toMatchObject({ qty: 2000, cost: 90, price: 100 });
    const result2 = buildHoldingEditTrade({ holding, targetQty: 2000, targetCost: 130, executionPrice: 180, now });
    expect(result2.ok).toBe(true);
    if (result2.ok) expect(applyTradeEntryToHoldings([holding], result2.entry)[0]).toMatchObject({ cost: 130, price: 100, value: 200000 });
  });

  it.each([
    { targetQty: 1000, targetCost: 80, executionPrice: 100 },
    { targetQty: 500, targetCost: 70, executionPrice: 100 },
    { targetQty: 2000, targetCost: 110, executionPrice: 100 },
    { targetQty: -1, targetCost: 80, executionPrice: 100 },
    { targetQty: 0, targetCost: 80, executionPrice: 100 },
    { targetQty: 500, targetCost: 80, executionPrice: 0 },
    { targetQty: 500.5, targetCost: 80, executionPrice: 100 },
  ])('拒絕無法代表真實成交或不合法的編輯：%o', (values) => {
    expect(buildHoldingEditTrade({ holding, ...values, now }).ok).toBe(false);
  });
});