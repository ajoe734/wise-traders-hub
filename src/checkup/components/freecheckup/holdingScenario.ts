// 持倉抽屜「情境模擬」純函式。獨立檔案便於 Vitest 單測。
//
// 規則：
//   - 加碼（Δqty > 0）：新均價 = (cost·qty + 加碼價·Δqty) / (qty + Δqty)
//                       未填加碼價時，沿用 cost（視為照舊均價買進）
//   - 減碼（Δqty < 0）：均價不變（先進先出/平均成本法皆然，僅實現損益）
//   - upside%  = (TARGET − price) / price × 100
//   - simPnl%  = (price − simAvgCost) / simAvgCost × 100
//   - r:r      = (TARGET − price) / max(price − stopPrice, ε)
//
// 全部欄位為 number | null/undefined；缺欄位回 null 避免 NaN 污染 UI。

export interface ScenarioInput {
  cost: number;
  qty: number;
  price: number;
  /** 模擬目標價；未填回原本 avgTarget */
  target?: number | null;
  /** 加減碼股數，可負 */
  deltaQty?: number;
  /** 加碼價，僅在 deltaQty > 0 才有意義 */
  buyMorePrice?: number | null;
  /** 停損價，用來算 risk:reward */
  stopPrice?: number | null;
}

export interface ScenarioOutput {
  simQty: number;
  simAvgCost: number;
  simValue: number;
  simPnlPct: number | null;
  simPnlAbs: number | null;
  upsidePct: number | null;
  riskReward: number | null;
  /** 「(price − stop) / cost」絕對風險佔比 */
  riskPct: number | null;
}

export function computeScenario(input: ScenarioInput): ScenarioOutput {
  const cost = num(input.cost);
  const qty = num(input.qty);
  const price = num(input.price);
  const delta = Number.isFinite(Number(input.deltaQty)) ? Number(input.deltaQty) : 0;
  const target = Number.isFinite(Number(input.target)) ? Number(input.target) : null;
  const buyMore = Number.isFinite(Number(input.buyMorePrice)) ? Number(input.buyMorePrice) : null;
  const stop = Number.isFinite(Number(input.stopPrice)) ? Number(input.stopPrice) : null;

  const addQty = Math.max(0, delta);
  const simQty = Math.max(0, qty + delta);
  const addPrice = buyMore != null && buyMore > 0 ? buyMore : cost;
  const simAvgCost = addQty > 0 && qty + addQty > 0
    ? (cost * qty + addPrice * addQty) / (qty + addQty)
    : cost;
  const simValue = price * simQty;

  const simPnlPct = simAvgCost > 0 && price > 0
    ? ((price - simAvgCost) / simAvgCost) * 100
    : null;
  const simPnlAbs = simPnlPct != null
    ? (price - simAvgCost) * simQty
    : null;

  const upsidePct = target != null && target > 0 && price > 0
    ? ((target - price) / price) * 100
    : null;

  const downside = stop != null && stop > 0 ? price - stop : null;
  const riskReward = target != null && downside != null && downside > 0
    ? (target - price) / downside
    : null;
  const riskPct = stop != null && stop > 0 && cost > 0
    ? ((price - stop) / cost) * 100
    : null;

  return { simQty, simAvgCost, simValue, simPnlPct, simPnlAbs, upsidePct, riskReward, riskPct };
}

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 是否與原值有任何差異（用來決定 SIMULATED 徽章顯示） */
export function isDirty(input: ScenarioInput, originalTarget: number | null): boolean {
  const delta = Number(input.deltaQty) || 0;
  if (delta !== 0) return true;
  if (input.buyMorePrice != null && input.buyMorePrice !== '') return true;
  if (input.stopPrice != null && input.stopPrice !== '') return true;
  if (input.target != null && originalTarget != null && Number(input.target) !== Number(originalTarget)) return true;
  return false;
}
