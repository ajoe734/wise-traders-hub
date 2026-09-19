/**
 * Signal trade business logic helpers extracted from handle_signal_trade
 * and handle_signal_takedown PostgreSQL triggers.
 * Mirrors ROUND(..., 2) in the SQL using Math.round(n * 100) / 100.
 *
 * SIGNAL_MATH_CONTRACT_V1（`src/lib/signalMath.contract.json`）：
 * 本檔的 applySignalMathVector 是前台唯一 canonical calculator；
 * SQL 鏡像是 `signal_math_apply`（migration，未套用前由 db/p0-signal-math
 * scenario 內聯同名函式驗證）。兩邊跑同一組 contract vectors，逐值一致。
 *
 * 口徑憲法：
 * - 內部單位一律「股」；「張→股」只能在入口換算一次（×1000，走 lotSize）。
 * - 現金：buy/add 扣 成交價×股數；sell/trim/exit 一律以「實際成交價×實際股數」
 *   回收（已實現損益因此進入現金），絕不得用成本價釋放。
 * - 金額輸出一律 ROUND(x, 2) half-up。
 */

export function r2(n: number): number {
  const v = Math.round(n * 100) / 100;
  return v === 0 ? 0 : v; // 消除 -0
}

/**
 * Weighted average entry price when adding to an existing position.
 * Mirrors: ROUND((existingQty * existingPrice + addQty * addPrice) / (existingQty + addQty), 2)
 */
export function calcWeightedAvgPrice(
  existingQty: number,
  existingPrice: number,
  addQty: number,
  addPrice: number,
): number {
  const totalQty = existingQty + addQty;
  if (totalQty <= 0) return existingPrice;
  return r2((existingQty * existingPrice + addQty * addPrice) / totalQty);
}

/**
 * PnL percentage for a closed trade.
 * Mirrors: ROUND(((exitPrice - entryPrice) / entryPrice) * 100, 2)
 */
export function calcPnlPercent(entryPrice: number, exitPrice: number): number {
  if (entryPrice <= 0) return 0;
  return r2(((exitPrice - entryPrice) / entryPrice) * 100);
}

/**
 * Reverse weighted average after recalling an add signal.
 * Mirrors: ROUND((openQty * openEntry - removeQty * removePrice) / (openQty - removeQty), 2)
 */
export function reverseWeightedAvgPrice(
  openQty: number,
  openEntry: number,
  removeQty: number,
  removePrice: number,
): number {
  const newQty = openQty - removeQty;
  if (newQty <= 0) return openEntry;
  return r2((openQty * openEntry - removeQty * removePrice) / newQty);
}

/**
 * Sell quantity capped at existing holding.
 * Mirrors: LEAST(COALESCE(signalQty, existingQty), existingQty)
 */
export function calcSellQty(signalQty: number | null, existingQty: number): number {
  return Math.min(signalQty ?? existingQty, existingQty);
}

export { normalizeQuantityToBaseUnits as normalizeSignalQuantityToShares } from '@/lib/positionQuantity';

import { lotsToShares } from '@/lib/lotSize';

// ---------------------------------------------------------------------------
// SIGNAL_MATH_CONTRACT_V1 — canonical calculator（contract vectors 的 TS 端）
// ---------------------------------------------------------------------------

export interface SignalMathInput {
  action: 'buy' | 'sell' | 'add' | 'trim' | 'exit' | string;
  /** 實際成交／參考價。 */
  price: number;
  /** 使用者輸入數量（搭配 unit）。 */
  quantity: number;
  /** '張' 或 '股'；換算只在此入口發生一次。 */
  unit: string;
  /** 執行前持有股數（base unit）。 */
  priorQtyShares: number;
  /** 執行前加權平均成本。 */
  priorAvg: number;
}

export interface SignalMathResult {
  /** 入口換算後的股數。 */
  shares: number;
  /** 實際成交股數（sell/trim 以持有量為上限；exit 為全部持有）。 */
  effectiveShares: number;
  /** 現金變化（負=扣款、正=回收），ROUND 2。 */
  cashDelta: number;
  newQty: number;
  newAvg: number;
  /** buy/add 後的部位成本（newQty × newAvg，ROUND 2）。 */
  positionCost?: number;
  /** sell/trim/exit 的已實現損益（(成交價−均價)×實際股數，ROUND 2）。 */
  realizedPnl?: number;
  pnlPercent?: number;
}

/**
 * 單筆交易的 canonical 結果。SQL 端 `signal_math_apply` 必須逐值一致，
 * 由 `src/lib/signalMath.contract.json` 的 vectors 雙端驗證。
 */
export function applySignalMathVector(input: SignalMathInput): SignalMathResult {
  const price = Number(input.price) || 0;
  const qtyRaw = Number(input.quantity) || 0;
  const shares = qtyRaw > 0
    ? (input.unit === '張' ? lotsToShares(Math.floor(qtyRaw)) : Math.floor(qtyRaw))
    : 0;
  const priorQty = Math.max(0, Number(input.priorQtyShares) || 0);
  const priorAvg = Number(input.priorAvg) || 0;
  const action = input.action;

  if (action === 'buy' || action === 'add') {
    const cashDelta = -r2(price * shares);
    const newQty = priorQty + shares;
    const newAvg = priorQty > 0
      ? calcWeightedAvgPrice(priorQty, priorAvg, shares, price)
      : r2(price);
    return {
      shares, effectiveShares: shares, cashDelta, newQty, newAvg,
      positionCost: r2(newQty * newAvg),
    };
  }

  if (action === 'sell' || action === 'trim' || action === 'exit') {
    // 實際成交股數：sell/trim 以持有量為上限；exit 為全部持有。
    const effective = action === 'exit'
      ? priorQty
      : Math.min(shares, priorQty);
    // 現金回收一律用「實際成交價 × 實際股數」（含已實現損益），不用成本價。
    const cashDelta = r2(price * effective);
    const newQty = priorQty - effective;
    const newAvg = newQty > 0 ? priorAvg : 0;
    const realizedPnl = r2((price - priorAvg) * effective);
    const pnlPercent = calcPnlPercent(priorAvg, price);
    return {
      shares, effectiveShares: effective, cashDelta, newQty, newAvg,
      realizedPnl, pnlPercent,
    };
  }

  // hold / teaching / 未知：不產生現金流、不動部位。
  return {
    shares, effectiveShares: 0, cashDelta: 0, newQty: priorQty, newAvg: priorAvg,
  };
}

export interface CashSimTrade {
  action: 'buy' | 'sell' | 'add' | 'trim' | 'exit' | string;
  /** 實際成交／參考價。sell/trim/exit 的現金回收一律用此價（SIGNAL_MATH_CONTRACT_V1）。 */
  price: number;
  shares: number;
  /** Existing open quantity for this symbol when action is 'exit' (used to release full cash) */
  exitShares?: number;
  /**
   * @deprecated SIGNAL_MATH_CONTRACT_V1 起 exit 以實際出場價回收現金，
   * 成本價釋放已廢棄；此欄位保留僅為型別相容，不再參與計算。
   */
  exitAvgPrice?: number;
}

/**
 * Simulate the analyst's available cash after submitting a list of trades.
 * - buy/add → consume price × shares
 * - sell/trim → release price × shares（實際成交價）
 * - exit → release price × exitShares（實際出場價 × 全部持有；不再用成本價）
 */
export function simulateCashAfterTrades(
  startCash: number,
  trades: CashSimTrade[],
): { remaining: number; perTrade: number[] } {
  let remaining = startCash;
  const perTrade: number[] = [];
  for (const t of trades) {
    const p = Number(t.price) || 0;
    const s = Number(t.shares) || 0;
    if (t.action === 'buy' || t.action === 'add') {
      remaining -= p * s;
    } else if (t.action === 'sell' || t.action === 'trim') {
      remaining += p * s;
    } else if (t.action === 'exit') {
      const sh = Number(t.exitShares) || s;
      remaining += p * sh;
    }
    perTrade.push(remaining);
  }
  return { remaining, perTrade };
}
