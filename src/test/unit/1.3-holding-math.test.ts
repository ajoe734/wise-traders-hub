/**
 * Group 1.3 — 持倉損益數學計算
 *
 * 對應測試路徑（核心邏輯分類 STEP_3）：
 *   5.5-1  精確模式股票（稅率 0.3%）→ calcNetSettlement + calcPnlWithNet
 *   5.5-2  精確模式 6 碼權證（稅率 0.1%）→ calcNetSettlement + calcPnlWithNet
 *   5.5-3  Fallback 損益 = (現價 - 均價) × 股數 → calculateHoldingUnrealizedPnl
 *   5.5-4  報酬率成本為 0 不除以零 → calculateHoldingReturnPct
 *   5.5-5  買進後加碼均價計算 → calcWeightedAvgCost
 *
 *   5.5-6  賣出後按比例縮減 totalCost/fee → calcRemainingCostAfterPartialSell
 *
 * 漏洞修正說明（2026-04-14）：
 *   [漏洞1] 5.5-5 改測 calcWeightedAvgCost()，驗證真正的加碼公式 (h.cost*h.qty+price*qty)/nq
 *   [漏洞2] 新增 5.5-1/5.5-2 calcNetSettlement()，驗證稅率 0.3%/0.1% 切換邏輯
 *   [漏洞3] 移除 calculateTotalMarketValue（dead code，生產未呼叫），
 *            改測 holdings.js 的 getHoldingMarketValue/getHoldingCostBasis（實際生產路徑）
 */

import { describe, it, expect } from 'vitest';
import {
  calculateHoldingCostBasis,
  calculateHoldingMarketValue,
  calculateHoldingUnrealizedPnl,
  calculateHoldingReturnPct,
  calcWeightedAvgCost,
  calcNetSettlement,
  calcPnlWithNet,
  calcRemainingCostAfterPartialSell,
} from '@/checkup/lib/holdingMath';
import {
  getHoldingMarketValue,
  getHoldingCostBasis,
} from '@/checkup/lib/holdings.js';

// ---------------------------------------------------------------------------
// calculateHoldingCostBasis — 成本總額 = 均價 × 股數
// ---------------------------------------------------------------------------

describe('calculateHoldingCostBasis()', () => {
  it('正常計算：均價 × 股數', () => {
    expect(calculateHoldingCostBasis(50, 1000)).toBe(50000);
  });

  it('字串輸入：轉為 number 後計算', () => {
    expect(calculateHoldingCostBasis('50', '1000')).toBe(50000);
  });

  it('null → 視為 0，結果為 0', () => {
    expect(calculateHoldingCostBasis(null, 1000)).toBe(0);
    expect(calculateHoldingCostBasis(50, null)).toBe(0);
  });

  it('NaN → 視為 0', () => {
    expect(calculateHoldingCostBasis(NaN, 1000)).toBe(0);
  });

  it('Infinity → 視為 0', () => {
    expect(calculateHoldingCostBasis(Infinity, 1000)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateHoldingMarketValue — 市值 = 現價 × 股數
// ---------------------------------------------------------------------------

describe('calculateHoldingMarketValue()', () => {
  it('正常計算：現價 × 股數', () => {
    expect(calculateHoldingMarketValue(60, 1000)).toBe(60000);
  });

  it('字串輸入：轉換後計算', () => {
    expect(calculateHoldingMarketValue('60', '1000')).toBe(60000);
  });

  it('現價為 0 → 市值為 0', () => {
    expect(calculateHoldingMarketValue(0, 1000)).toBe(0);
  });

  it('null → 視為 0', () => {
    expect(calculateHoldingMarketValue(null, 1000)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5.5-3 calculateHoldingUnrealizedPnl — Fallback 損益 = (現價 - 均價) × 股數
// ---------------------------------------------------------------------------

describe('5.5-3 calculateHoldingUnrealizedPnl() — Fallback 損益計算', () => {
  it('獲利：現價 > 均價 → 正數損益', () => {
    expect(calculateHoldingUnrealizedPnl(55, 1000, 50)).toBe(5000);
  });

  it('虧損：現價 < 均價 → 負數損益', () => {
    expect(calculateHoldingUnrealizedPnl(45, 1000, 50)).toBe(-5000);
  });

  it('損益平衡：現價 = 均價 → 0', () => {
    expect(calculateHoldingUnrealizedPnl(50, 1000, 50)).toBe(0);
  });

  it('參數順序驗證：price 在前、cost 在後，互換結果符號相反', () => {
    const gain = calculateHoldingUnrealizedPnl(60, 1000, 50);
    const loss = calculateHoldingUnrealizedPnl(50, 1000, 60);
    expect(gain).toBe(10000);
    expect(loss).toBe(-10000);
  });

  it('小數均價（權證）：不因浮點誤差產生極大偏差', () => {
    const result = calculateHoldingUnrealizedPnl(0.66, 10000, 0.61);
    expect(result).toBeCloseTo(500, 1);
  });

  it('null 輸入：不拋出錯誤', () => {
    expect(() => calculateHoldingUnrealizedPnl(null, null, null)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5.5-4 calculateHoldingReturnPct — 報酬率，成本為 0 時回傳 0%
// ---------------------------------------------------------------------------

describe('5.5-4 calculateHoldingReturnPct() — 報酬率零除法防護', () => {
  it('成本總額 = 0（cost=0）→ 回傳 0%，不除以零', () => {
    expect(calculateHoldingReturnPct(60, 1000, 0)).toBe(0);
  });

  it('成本總額 < 0（cost 為負數）→ 回傳 0%', () => {
    expect(calculateHoldingReturnPct(60, 1000, -50)).toBe(0);
  });

  it('null cost → 視為 0，回傳 0%', () => {
    expect(calculateHoldingReturnPct(60, 1000, null)).toBe(0);
  });

  it('正常獲利報酬率：+20%', () => {
    expect(calculateHoldingReturnPct(60, 1000, 50)).toBeCloseTo(20, 5);
  });

  it('虧損報酬率：-20%', () => {
    expect(calculateHoldingReturnPct(40, 1000, 50)).toBeCloseTo(-20, 5);
  });

  it('非整除報酬率：公式為 (price-cost)/cost，非 price/cost', () => {
    // price=53, cost=50 → pct=6%；若用 price/cost×100 得 106%
    expect(calculateHoldingReturnPct(53, 1000, 50)).toBeCloseTo(6, 5);
  });

  it('損益平衡：報酬率 0%', () => {
    expect(calculateHoldingReturnPct(50, 1000, 50)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// [漏洞1修正] 5.5-5 calcWeightedAvgCost — 加碼加權均價
// 測試真正的公式：(h.cost * h.qty + price * qty) / (h.qty + qty)
// ---------------------------------------------------------------------------

describe('5.5-5 calcWeightedAvgCost() — 加碼加權均價', () => {
  it('加碼：按數量加權計算新均價', () => {
    // 持有 1000 張 @50，加碼 500 張 @60
    // nc = (50*1000 + 60*500) / 1500 = 80000/1500 = 53.333...
    expect(calcWeightedAvgCost(50, 1000, 60, 500)).toBeCloseTo(53.333, 2);
  });

  it('加碼相同均價：均價不變', () => {
    expect(calcWeightedAvgCost(50, 1000, 50, 500)).toBeCloseTo(50, 5);
  });

  it('公式方向驗證：加碼高價 → 均價上升（而非下降）', () => {
    const nc = calcWeightedAvgCost(50, 1000, 80, 1000);
    // nc = (50*1000 + 80*1000) / 2000 = 65
    expect(nc).toBeCloseTo(65, 5);
    expect(nc).toBeGreaterThan(50); // 均價必須上升
    expect(nc).toBeLessThan(80);    // 但不超過加碼價
  });

  it('公式方向驗證：加碼低價 → 均價下降（攤平）', () => {
    const nc = calcWeightedAvgCost(80, 1000, 50, 1000);
    expect(nc).toBeCloseTo(65, 5);
    expect(nc).toBeLessThan(80);
    expect(nc).toBeGreaterThan(50);
  });

  it('totalQty = 0 邊界：回傳 0，不除以零', () => {
    expect(calcWeightedAvgCost(50, 0, 60, 0)).toBe(0);
  });

  it('首次建倉（currentQty=0）：均價等於買入價', () => {
    expect(calcWeightedAvgCost(0, 0, 60, 1000)).toBeCloseTo(60, 5);
  });
});

// ---------------------------------------------------------------------------
// [漏洞2修正] 5.5-1/5.5-2 calcNetSettlement — 精確模式淨收付（含稅）
// ---------------------------------------------------------------------------

describe('5.5-1/5.5-2 calcNetSettlement() — 精確模式稅率', () => {
  it('5.5-1：股票（4碼）稅率 0.3%，正確扣除', () => {
    // 市值 100000，fee 143，稅 = round(100000 * 0.003) = 300
    // net = 100000 - 143 - 300 = 99557
    expect(calcNetSettlement(100000, 143, '2330')).toBe(99557);
  });

  it('5.5-2：權證（6碼）稅率 0.1%，非 0.3%', () => {
    // 市值 100000，fee 143，稅 = round(100000 * 0.001) = 100
    // net = 100000 - 143 - 100 = 99757
    // 若錯用 0.3% 則得 99557，差距 200 — 這才是能抓到錯誤的測試
    expect(calcNetSettlement(100000, 143, '032411')).toBe(99757);
  });

  it('4碼 vs 6碼 稅率差距可量化：同樣市值下差 200 元', () => {
    const stock   = calcNetSettlement(100000, 0, '2330');   // 稅 300
    const warrant = calcNetSettlement(100000, 0, '032411'); // 稅 100
    expect(stock).toBe(99700);
    expect(warrant).toBe(99900);
    expect(warrant - stock).toBe(200);
  });

  it('fee 為 null → 視為 0，不報錯', () => {
    expect(calcNetSettlement(100000, null, '2330')).toBe(99700);
  });

  it('fee 為 undefined → 視為 0，不報錯', () => {
    expect(calcNetSettlement(100000, undefined, '2330')).toBe(99700);
  });

  it('5碼代碼（ETF 等）→ 走 else（0.3%），非 6 碼', () => {
    // '00878' 是 5 碼，稅率 0.3%
    const etf = calcNetSettlement(100000, 0, '00878');
    expect(etf).toBe(99700); // 同股票 0.3%
  });

  it('Math.round 稅額：市值非整百時正確四捨五入', () => {
    // 市值 99999，stock 0.3% → tax = round(99999 * 0.003) = round(299.997) = 300
    expect(calcNetSettlement(99999, 0, '2330')).toBe(99699);
  });
});

// ---------------------------------------------------------------------------
// [漏洞3修正] getHoldingMarketValue / getHoldingCostBasis — 實際生產路徑
// （routeRuntime.js 和 usePortfolioDerivedData.js 呼叫的是這兩個，非 calculateTotalMarketValue）
// ---------------------------------------------------------------------------

describe('getHoldingMarketValue() — 生產路徑市值計算', () => {
  it('使用 item.price 計算市值', () => {
    expect(getHoldingMarketValue({ price: 60, qty: 1000, cost: 50 })).toBe(60000);
  });

  it('item.price 優先於 item.cost（不使用均價當現價）', () => {
    // price=60, cost=50 → 60×1000=60000，非 50×1000=50000
    const result = getHoldingMarketValue({ price: 60, qty: 1000, cost: 50 });
    expect(result).toBe(60000);
    expect(result).not.toBe(50000);
  });

  it('overridePrice（API 即時報價）優先於 item.price', () => {
    expect(getHoldingMarketValue({ price: 60, qty: 1000, cost: 50 }, 70)).toBe(70000);
  });

  it('無 price 時 fallback 到 value/qty', () => {
    // price 未設，value=65000, qty=1000 → 推算單價 65 → 市值 65000
    expect(getHoldingMarketValue({ value: 65000, qty: 1000, cost: 50 })).toBe(65000);
  });

  it('null item → 回傳 0，不拋出錯誤', () => {
    expect(() => getHoldingMarketValue(null)).not.toThrow();
    expect(getHoldingMarketValue(null)).toBe(0);
  });

  it('非物件輸入 → 回傳 0', () => {
    expect(getHoldingMarketValue('invalid')).toBe(0);
    expect(getHoldingMarketValue(123)).toBe(0);
  });
});

describe('getHoldingCostBasis() — 生產路徑成本基礎', () => {
  it('物件輸入：cost × qty', () => {
    expect(getHoldingCostBasis({ cost: 50, qty: 1000 })).toBe(50000);
  });

  it('null item → 回傳 0，不拋出錯誤', () => {
    expect(() => getHoldingCostBasis(null)).not.toThrow();
    expect(getHoldingCostBasis(null)).toBe(0);
  });

  it('非物件輸入 → 回傳 0', () => {
    expect(getHoldingCostBasis('invalid')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// [Issue 2 完整修正] calcPnlWithNet — 精確模式正式路徑
// 驗證 pnl = net - totalCost（而非 newValue - totalCost）
// ---------------------------------------------------------------------------

describe('5.5-1/5.5-2 calcPnlWithNet() — 精確模式正式計算路徑', () => {
  // 5.5-1：股票（4碼，稅率 0.3%）
  it('5.5-1 精確模式股票：pnl = net - totalCost，非 newValue - totalCost', () => {
    // h.qty=1000, h.cost=50, h.totalCost=50071（含買進手續費71）, h.fee=143, code='2330'
    // newPrice=60 → newValue=60000
    // net = calcNetSettlement(60000, 143, '2330') = 60000 - 143 - round(60000*0.003=180) = 59677
    // pnl = 59677 - 50071 = 9606
    // 若錯用 newValue - totalCost = 60000 - 50071 = 9929 ≠ 9606 → 測試會亮紅燈
    const h = { qty: 1000, cost: 50, totalCost: 50071, fee: 143, code: '2330' };
    const result = calcPnlWithNet(h, 60);
    expect(result.value).toBe(60000);
    expect(result.pnl).toBe(9606);
    expect(result.pct).toBe(19.18); // Math.round(9606/50071×10000)/100 = Math.round(1918.48)/100
  });

  // 5.5-2：權證（6碼，稅率 0.1%）
  it('5.5-2 精確模式權證：稅率使用 0.1%（非股票的 0.3%）', () => {
    // h.qty=10000, h.totalCost=5043（含買進費）, h.fee=43, code='032411'
    // newPrice=0.66 → newValue=6600
    // net = calcNetSettlement(6600, 43, '032411') = 6600 - 43 - round(6600*0.001=6.6→7) = 6550
    // pnl = 6550 - 5043 = 1507
    // 若錯用股票稅率 0.3%：net = 6600 - 43 - round(6600*0.003=19.8→20) = 6537，pnl = 1494 ≠ 1507
    const h = { qty: 10000, cost: 0.5, totalCost: 5043, fee: 43, code: '032411' };
    const result = calcPnlWithNet(h, 0.66);
    expect(result.value).toBe(6600);
    expect(result.pnl).toBe(1507);
    expect(result.pct).toBe(29.88); // Math.round(1507/5043×10000)/100 = Math.round(2988.2)/100
  });

  it('精確模式：totalCost = 0 → pct 回傳 0，不除以零', () => {
    const h = { qty: 1000, cost: 50, totalCost: 0, fee: 100, code: '2330' };
    const result = calcPnlWithNet(h, 60);
    expect(result.pct).toBe(0);
    expect(result.pnl).not.toBeNaN();
  });

  it('Fallback 模式：totalCost = null → 走 (newPrice - cost) × qty', () => {
    // totalCost null → hasCostAndFee = false → fallback
    // pnl = round((60 - 50) * 1000) = 10000
    const h = { qty: 1000, cost: 50, totalCost: null, fee: null, code: '2330' };
    const result = calcPnlWithNet(h, 60);
    expect(result.value).toBe(60000);
    expect(result.pnl).toBe(10000);
  });

  it('精確 vs Fallback：相同持倉，有無 totalCost 結果不同（確認兩路徑確實相異）', () => {
    const base = { qty: 1000, cost: 50, fee: 143, code: '2330' };
    const precise   = calcPnlWithNet({ ...base, totalCost: 50071 }, 60);
    const fallback  = calcPnlWithNet({ ...base, totalCost: null  }, 60);
    // 精確：9606，Fallback：10000，確認不同路徑
    expect(precise.pnl).not.toBe(fallback.pnl);
    expect(precise.pnl).toBe(9606);
    expect(fallback.pnl).toBe(10000);
  });
});

// ---------------------------------------------------------------------------
// [Issue 2 完整修正 + 5.5-6] calcRemainingCostAfterPartialSell
// 驗證賣出後 totalCost/fee 按持股比例縮減
// ---------------------------------------------------------------------------

describe('5.5-6 calcRemainingCostAfterPartialSell() — 賣出後比例縮減', () => {
  it('賣出一半：totalCost 和 fee 各縮減 50%', () => {
    // 持有 1000 張，賣 500，剩 500，ratio = 0.5
    // newTotalCost = round(50071 * 0.5) = round(25035.5) = 25036
    // newFee = round(143 * 0.5) = round(71.5) = 72
    const { newTotalCost, newFee } = calcRemainingCostAfterPartialSell(50071, 143, 500, 1000);
    expect(newTotalCost).toBe(25036);
    expect(newFee).toBe(72);
  });

  it('賣出 1/3：剩 2/3，Math.round 正確四捨五入', () => {
    // remainQty=667, originalQty=1000, ratio=0.667
    // totalCost=30000 → round(30000 * 0.667) = round(20010) = 20010
    const { newTotalCost } = calcRemainingCostAfterPartialSell(30000, 100, 667, 1000);
    expect(newTotalCost).toBe(Math.round(30000 * (667 / 1000)));
  });

  it('totalCost 為 null → newTotalCost 仍為 null', () => {
    const { newTotalCost, newFee } = calcRemainingCostAfterPartialSell(null, 143, 500, 1000);
    expect(newTotalCost).toBeNull();
    expect(newFee).toBe(72);
  });

  it('fee 為 null → newFee 仍為 null', () => {
    const { newTotalCost, newFee } = calcRemainingCostAfterPartialSell(50071, null, 500, 1000);
    expect(newTotalCost).toBe(25036);
    expect(newFee).toBeNull();
  });

  it('originalQty = 0 → 回傳 {null, null}，不除以零', () => {
    const result = calcRemainingCostAfterPartialSell(50000, 100, 0, 0);
    expect(result.newTotalCost).toBeNull();
    expect(result.newFee).toBeNull();
  });

  it('全部賣光（remainQty = 0）→ totalCost 和 fee 歸零', () => {
    const { newTotalCost, newFee } = calcRemainingCostAfterPartialSell(50071, 143, 0, 1000);
    expect(newTotalCost).toBe(0);
    expect(newFee).toBe(0);
  });
});
