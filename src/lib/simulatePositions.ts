// 同一批訊號裡前一筆會影響庫存（例如先賣 5 張再加 3 張），
// 提交前要在前端模擬，避免 add/trim/sell/exit 驗證誤判。

export type TradeAction = 'buy' | 'sell' | 'add' | 'trim' | 'exit';

export interface PositionSnapshot {
  /** 股票代碼（不含名稱） */
  symbol: string;
  quantity: number;
}

export interface SimulatedTrade {
  symbol: string;
  action: TradeAction;
  quantity: number;
}

/**
 * 從現有持倉出發，依序套用 trades，回傳模擬後的持倉表。
 * 不需要嚴格的成本計算，這裡只關心「有沒有部位／剩多少股」。
 */
export function simulatePositions(
  initial: PositionSnapshot[],
  trades: SimulatedTrade[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of initial) {
    map.set(p.symbol, (map.get(p.symbol) || 0) + (p.quantity || 0));
  }
  for (const t of trades) {
    const cur = map.get(t.symbol) || 0;
    if (t.action === 'buy' || t.action === 'add') {
      map.set(t.symbol, cur + (t.quantity || 0));
    } else if (t.action === 'sell' || t.action === 'trim') {
      map.set(t.symbol, Math.max(0, cur - (t.quantity || 0)));
    } else if (t.action === 'exit') {
      map.set(t.symbol, 0);
    }
  }
  return map;
}
