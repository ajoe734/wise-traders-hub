/**
 * Signal trade business logic helpers extracted from handle_signal_trade
 * and handle_signal_takedown PostgreSQL triggers.
 * Mirrors ROUND(..., 2) in the SQL using Math.round(n * 100) / 100.
 */

function r2(n: number): number {
  return Math.round(n * 100) / 100;
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

/**
 * Normalize signal quantity into actual shares for trade_records storage.
 * Mirrors trigger logic:
 * - 張 => quantity * 1000
 * - 股 => quantity
 * - empty/invalid => fallback 1
 */
export function normalizeSignalQuantityToShares(
  quantity: number | null | undefined,
  quantityUnit: string | null | undefined,
): number {
  if (!quantity || quantity <= 0) return 1;
  return quantityUnit === '張' ? quantity * 1000 : quantity;
}

export interface CashSimTrade {
  action: 'buy' | 'sell' | 'add' | 'trim' | 'exit' | string;
  price: number;
  shares: number;
  /** Existing open quantity for this symbol when action is 'exit' (used to release full cash) */
  exitShares?: number;
  /** Average entry price for the existing position when action is 'exit' (cash released = avg * shares) */
  exitAvgPrice?: number;
}

/**
 * Simulate the analyst's available cash after submitting a list of trades.
 * - buy/add → consume price × shares
 * - sell/trim → release price × shares (rough — uses exit price)
 * - exit → release exitAvgPrice × exitShares if provided, otherwise price × shares
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
      const ap = Number(t.exitAvgPrice) || p;
      remaining += ap * sh;
    }
    perTrade.push(remaining);
  }
  return { remaining, perTrade };
}
