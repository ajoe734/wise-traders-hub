import { simulatePositions, type TradeAction } from '@/lib/simulatePositions';
import {
  normalizeSignalQuantityToShares,
  calcWeightedAvgPrice,
} from '@/lib/signalTradeLogic';
import {
  actionLabels, fmtMoney,
  type CapitalStatus, type OpenPosition, type TradeDraft,
} from './types';
import { sanitizeRichHtml } from '@/lib/sanitizeHtml';

interface SimState {
  /** 模擬剩餘股數 */
  qty: number;
  /** 模擬加權平均成本 */
  avg: number;
}

/**
 * 從目前 capital 起始狀態，依序套用 trades，回傳每一筆「執行『前』」的 SimState。
 * 同檔股票多筆會逐筆累積；cash sim、validator 共用這份。
 */
function buildStepStates(
  trades: TradeDraft[],
  capital: CapitalStatus | null,
): { perTrade: SimState[]; finalMap: Map<string, SimState> } {
  const state = new Map<string, SimState>();
  (capital?.open_positions || []).forEach((p) => {
    state.set(p.symbol, { qty: p.quantity_shares || 0, avg: p.entry_price || 0 });
  });
  const perTrade: SimState[] = [];

  for (const t of trades) {
    const code = (t.stockCode || '').trim();
    const before: SimState = code
      ? { ...(state.get(code) || { qty: 0, avg: 0 }) }
      : { qty: 0, avg: 0 };
    perTrade.push(before);

    if (!code || !t.action) continue;
    const shares = normalizeSignalQuantityToShares(
      parseInt(t.quantity || '0', 10) || 0,
      t.quantityUnit,
    );
    const price = parseFloat(t.priceHint || '0') || 0;
    const cur = state.get(code) || { qty: 0, avg: 0 };

    if (t.action === 'buy') {
      // 開新倉
      const newQty = cur.qty + shares;
      const newAvg = cur.qty > 0
        ? calcWeightedAvgPrice(cur.qty, cur.avg, shares, price)
        : price;
      state.set(code, { qty: newQty, avg: newAvg });
    } else if (t.action === 'add') {
      const newQty = cur.qty + shares;
      const newAvg = cur.qty > 0
        ? calcWeightedAvgPrice(cur.qty, cur.avg, shares, price)
        : price; // sim qty=0 時 add 視同重新開倉，採用本次價
      state.set(code, { qty: newQty, avg: newAvg });
    } else if (t.action === 'sell' || t.action === 'trim') {
      const sellQty = Math.min(shares, cur.qty);
      const remain = cur.qty - sellQty;
      state.set(code, { qty: remain, avg: remain > 0 ? cur.avg : 0 });
    } else if (t.action === 'exit') {
      state.set(code, { qty: 0, avg: 0 });
    }
  }
  return { perTrade, finalMap: state };
}

/** 將 trades 轉為 `simulateCashAfterTrades` 需要的 row 形狀（同檔多筆會用模擬狀態避免雙扣）。 */
export function buildCashSimTrades(trades: TradeDraft[], capital: CapitalStatus | null) {
  const { perTrade } = buildStepStates(trades, capital);
  return trades.map((t, i) => {
    const shares = normalizeSignalQuantityToShares(
      parseInt(t.quantity || '0', 10) || 0,
      t.quantityUnit,
    );
    const before = perTrade[i];
    return {
      action: (t.action || '') as any,
      price: parseFloat(t.priceHint || '0') || 0,
      shares,
      // exit 釋放現金以「執行前」的模擬持倉與均價計算
      exitShares: before.qty,
      exitAvgPrice: before.avg,
    };
  });
}

/** 根據目前 trades 推導出「執行後」每檔股票的張數，用於 UI 預覽。 */
export function buildSimulatedPositions(
  trades: TradeDraft[],
  capital: CapitalStatus | null,
) {
  const initial = (capital?.open_positions || []).map((p) => ({
    symbol: p.symbol,
    quantity: p.quantity_shares,
  }));
  const simTrades = trades
    .filter((t) => t.stockCode.trim() && t.action)
    .map((t) => ({
      symbol: t.stockCode.trim(),
      action: t.action as TradeAction,
      quantity: normalizeSignalQuantityToShares(
        parseInt(t.quantity || '0', 10) || 0,
        t.quantityUnit,
      ),
    }));
  return simulatePositions(initial, simTrades);
}

/**
 * 整批 trades 的硬性檢查；任何一條失敗就回傳第一個錯誤訊息。
 * 支援同檔股票多筆混合 add / trim / sell / exit / buy（會逐筆套用模擬狀態）。
 */
export function validateSignalBatch(args: {
  expert: any;
  trades: TradeDraft[];
  openPositions: { symbol: string; quantity: number }[];
  capital: CapitalStatus | null;
}): string | null {
  const { expert, trades, capital } = args;
  if (!expert) return '找不到分析師資料';
  if (trades.length === 0) return '至少要有一檔股票';

  // 模擬狀態：qty + avg
  const state = new Map<string, SimState>();
  (capital?.open_positions || []).forEach((p) => {
    state.set(p.symbol, { qty: p.quantity_shares || 0, avg: p.entry_price || 0 });
  });

  let remaining = capital?.available_cash || 0;
  // 對 unit 一致性檢查 (qty 比較要用「股」)
  const toShares = (qty: number, unit: string) =>
    normalizeSignalQuantityToShares(qty, unit);

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const tag = `第 ${i + 1} 檔`;
    if (!t.stockCode.trim()) return `${tag}：請填股票代碼`;
    if (!t.action) return `${tag}：請選操作方向`;
    if (!t.executedAt) return `${tag}：請填操作時間`;
    const qty = parseInt(t.quantity || '0', 10);
    if (!qty || qty <= 0) return `${tag}：請填數量`;
    const price = parseFloat(t.priceHint || '0');
    if (!price || price <= 0) return `${tag}：請填參考價格`;

    const code = t.stockCode.trim();
    const shares = toShares(qty, t.quantityUnit);
    const cur = state.get(code) || { qty: 0, avg: 0 };

    // 顯示模擬持倉時換回原單位提示
    const fmtQty = (sh: number) =>
      t.quantityUnit === '張' ? `${(sh / 1000).toLocaleString()} 張` : `${sh.toLocaleString()} 股`;

    if (t.action === 'trim' || t.action === 'sell' || t.action === 'exit') {
      if (cur.qty <= 0) {
        return `${tag}：目前模擬持倉為 0，無法執行${actionLabels[t.action]}（請改用「買進」或調整前面幾筆）`;
      }
      if ((t.action === 'trim' || t.action === 'sell') && shares > cur.qty) {
        return `${tag}：${actionLabels[t.action]}數量 (${fmtQty(shares)}) 超過目前模擬持倉 (${fmtQty(cur.qty)})`;
      }
    }
    // 注意：'add' 在 sim cur=0 時不再阻擋，視為重新開倉（後端 trigger 找不到 open record 會自動 INSERT 新 record）

    if (t.action === 'buy' || t.action === 'add') {
      const required = price * shares;
      if (required > remaining) {
        return `${tag}：本筆需 ${fmtMoney(required)}，剩餘可用現金僅 ${fmtMoney(remaining)}，已超過操作金額上限`;
      }
      remaining -= required;
      const newQty = cur.qty + shares;
      const newAvg = cur.qty > 0
        ? calcWeightedAvgPrice(cur.qty, cur.avg, shares, price)
        : price;
      state.set(code, { qty: newQty, avg: newAvg });
    } else if (t.action === 'sell' || t.action === 'trim') {
      remaining += price * shares;
      const remain = cur.qty - shares;
      state.set(code, { qty: remain, avg: remain > 0 ? cur.avg : 0 });
    } else if (t.action === 'exit') {
      // 平倉以目前模擬均價×剩餘股數釋放現金
      remaining += (cur.avg || price) * cur.qty;
      state.set(code, { qty: 0, avg: 0 });
    }
  }
  return null;
}

/** 把 trades 轉成 expert_signals insert payload 陣列。 */
export function buildPublishRows(args: {
  expertId: string;
  batchId: string;
  status: string;
  isMentor: boolean;
  teachingTopic: string;
  overallSummary: string;
  learningPoints: string;
  trades: TradeDraft[];
}) {
  const { expertId, batchId, status, isMentor, teachingTopic, overallSummary, learningPoints, trades } = args;
  return trades.map((t, idx) => {
    const instrument = t.stockName.trim()
      ? `${t.stockCode.trim()} ${t.stockName.trim()}`
      : t.stockCode.trim();
    return {
      expert_id: expertId,
      plan_id: null,
      batch_id: batchId,
      instrument,
      action: t.action as any,
      price_hint: parseFloat(t.priceHint),
      quantity: parseInt(t.quantity, 10),
      quantity_unit: t.quantityUnit,
      executed_at: new Date(t.executedAt).toISOString(),
      reason_summary: sanitizeRichHtml(t.reasonSummary),
      reason_detail: sanitizeRichHtml(t.reasonDetail),
      risk_notes: sanitizeRichHtml(t.riskNotes),
      teaching_topic: idx === 0 && isMentor ? teachingTopic || null : null,
      overall_summary: idx === 0 && isMentor ? sanitizeRichHtml(overallSummary) || null : null,
      learning_points: idx === 0 && isMentor ? sanitizeRichHtml(learningPoints) || null : null,
      status: status as any,
    } as any;
  });
}

// 保留 OpenPosition 型別引用以避免未使用警告
export type { OpenPosition };
