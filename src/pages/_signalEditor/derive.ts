import { simulatePositions, type TradeAction } from '@/lib/simulatePositions';
import {
  normalizeSignalQuantityToShares,
  calcWeightedAvgPrice,
} from '@/lib/signalTradeLogic';
import {
  actionLabels,
  type CapitalStatus, type OpenPosition, type TradeDraft,
} from './types';
import { sanitizeRichHtml } from '@/lib/sanitizeHtml';
import {
  formatMoneyByCurrency, isValidSymbol, normalizeCurrency, symbolPlaceholder,
  type Currency,
} from '@/lib/currency';

interface SimState {
  /** 模擬剩餘股數 */
  qty: number;
  /** 模擬加權平均成本 */
  avg: number;
}

/**
 * 執行語意排序：釋放資金優先，再來才是消耗資金。
 * 顯示順序（讀者端）依 executed_at，由分析師輸入決定；
 * 這裡只決定資料庫 INSERT 順序與 sequential simulation 順序。
 */
const EXEC_ORDER: Record<string, number> = {
  exit: 0,
  trim: 1,
  sell: 2,
  add: 3,
  buy: 4,
};

/** 回傳 trades 依執行語意排序的 index 陣列（內含原始 index）。 */
function executionOrder(trades: TradeDraft[]): number[] {
  return trades
    .map((t, i) => ({ rank: EXEC_ORDER[t.action || ''] ?? 9, i }))
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.i - b.i))
    .map((x) => x.i);
}

/**
 * 從目前 capital 起始狀態，**依執行順序**套用 trades，回傳：
 *   - perTradeBefore: index 對齊「原始 trades 陣列」，值＝該筆執行『前』的 SimState
 *   - finalMap: 全部執行完畢的最終持倉表
 */
function buildStepStates(
  trades: TradeDraft[],
  capital: CapitalStatus | null,
): { perTradeBefore: SimState[]; finalMap: Map<string, SimState> } {
  const state = new Map<string, SimState>();
  (capital?.open_positions || []).forEach((p) => {
    state.set(p.symbol, { qty: p.quantity_shares || 0, avg: p.entry_price || 0 });
  });

  const perTradeBefore: SimState[] = new Array(trades.length).fill(null).map(
    () => ({ qty: 0, avg: 0 }),
  );

  const order = executionOrder(trades);
  for (const idx of order) {
    const t = trades[idx];
    const code = (t.stockCode || '').trim();
    perTradeBefore[idx] = code
      ? { ...(state.get(code) || { qty: 0, avg: 0 }) }
      : { qty: 0, avg: 0 };

    if (!code || !t.action) continue;
    const shares = normalizeSignalQuantityToShares(
      parseInt(t.quantity || '0', 10) || 0,
      t.quantityUnit,
    );
    const price = parseFloat(t.priceHint || '0') || 0;
    const cur = state.get(code) || { qty: 0, avg: 0 };

    if (t.action === 'buy') {
      const newQty = cur.qty + shares;
      const newAvg = cur.qty > 0
        ? calcWeightedAvgPrice(cur.qty, cur.avg, shares, price)
        : price;
      state.set(code, { qty: newQty, avg: newAvg });
    } else if (t.action === 'add') {
      const newQty = cur.qty + shares;
      const newAvg = cur.qty > 0
        ? calcWeightedAvgPrice(cur.qty, cur.avg, shares, price)
        : price;
      state.set(code, { qty: newQty, avg: newAvg });
    } else if (t.action === 'sell' || t.action === 'trim') {
      const sellQty = Math.min(shares, cur.qty);
      const remain = cur.qty - sellQty;
      state.set(code, { qty: remain, avg: remain > 0 ? cur.avg : 0 });
    } else if (t.action === 'exit') {
      state.set(code, { qty: 0, avg: 0 });
    }
  }
  return { perTradeBefore, finalMap: state };
}

/**
 * 計算整批 trades 在執行順序下的現金流：
 *   - remaining: 全部執行完後的剩餘可用現金
 *   - perTrade:  長度 = trades.length，index 對齊**原始 UI 順序**，值＝該筆執行『前』的可用現金
 *
 * UI 端「最大可買」「送出後預估可用現金」皆走這個函式。
 */
export function computeCashSim(
  trades: TradeDraft[],
  capital: CapitalStatus | null,
): { remaining: number; perTrade: number[] } {
  const startCash = capital?.available_cash || 0;
  const perTrade: number[] = new Array(trades.length).fill(startCash);
  if (trades.length === 0) return { remaining: startCash, perTrade };

  const { perTradeBefore } = buildStepStates(trades, capital);
  const order = executionOrder(trades);

  let remaining = startCash;
  for (const idx of order) {
    perTrade[idx] = remaining; // 記錄「執行前」可用現金（對齊原始 UI index）
    const t = trades[idx];
    const code = (t.stockCode || '').trim();
    if (!code || !t.action) continue;

    const shares = normalizeSignalQuantityToShares(
      parseInt(t.quantity || '0', 10) || 0,
      t.quantityUnit,
    );
    const price = parseFloat(t.priceHint || '0') || 0;
    const before = perTradeBefore[idx];

    if (t.action === 'buy' || t.action === 'add') {
      remaining -= price * shares;
    } else if (t.action === 'sell' || t.action === 'trim') {
      remaining += price * shares;
    } else if (t.action === 'exit') {
      // 平倉以執行前的模擬持倉與均價釋放現金
      remaining += (before.avg || price) * before.qty;
    }
  }
  return { remaining, perTrade };
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
  // 依執行順序送入 simulatePositions，最終 map 才會正確（避免「先加碼後減碼」誤判）
  const order = executionOrder(trades);
  const simTrades = order
    .map((i) => trades[i])
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
 * 以**執行語意順序**逐筆套用模擬狀態，但錯誤訊息中的「第 N 檔」沿用**原始 UI index**，
 * 讓分析師能在卡片上找到對應那張。
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

  const currency: Currency = normalizeCurrency(expert?.currency);
  const fmt = (n: number) => formatMoneyByCurrency(n, currency);

  // ── 先做欄位完整性檢查（依原始 UI 順序，先填好再排序執行） ──
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const tag = `第 ${i + 1} 檔`;
    if (!t.stockCode.trim()) return `${tag}：請填股票代碼`;
    if (!isValidSymbol(t.stockCode.trim().toUpperCase(), currency)) {
      return `${tag}：股票代碼格式錯誤（${symbolPlaceholder(currency)}）`;
    }
    if (currency === 'USD' && t.quantityUnit !== '股') {
      return `${tag}：美股單位只能用「股」`;
    }
    if (!t.action) return `${tag}：請選操作方向`;
    if (!t.executedAt) return `${tag}：請填操作時間`;
    const qty = parseInt(t.quantity || '0', 10);
    if (!qty || qty <= 0) return `${tag}：請填數量`;
    const price = parseFloat(t.priceHint || '0');
    if (!price || price <= 0) return `${tag}：請填參考價格`;
  }

  // ── 依執行語意順序跑 sequential simulation ──
  const state = new Map<string, SimState>();
  (capital?.open_positions || []).forEach((p) => {
    state.set(p.symbol, { qty: p.quantity_shares || 0, avg: p.entry_price || 0 });
  });

  let remaining = capital?.available_cash || 0;
  const toShares = (qty: number, unit: string) =>
    normalizeSignalQuantityToShares(qty, unit);

  const order = executionOrder(trades);
  for (const i of order) {
    const t = trades[i];
    const tag = `第 ${i + 1} 檔（${actionLabels[t.action] || t.action}）`;
    const qty = parseInt(t.quantity || '0', 10);
    const price = parseFloat(t.priceHint || '0');
    const code = t.stockCode.trim();
    const shares = toShares(qty, t.quantityUnit);
    const cur = state.get(code) || { qty: 0, avg: 0 };

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

    if (t.action === 'buy' || t.action === 'add') {
      const required = price * shares;
      if (required > remaining) {
        return `${tag}：本筆需 ${fmt(required)}，扣除同批減碼／平倉釋放的資金後可用現金僅 ${fmt(remaining)}，已超過操作金額上限`;
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
      remaining += (cur.avg || price) * cur.qty;
      state.set(code, { qty: 0, avg: 0 });
    }
  }
  return null;
}

/**
 * 把 trades 轉成 expert_signals insert payload 陣列。
 * **依執行語意順序**排出，這樣 DB 的 BEFORE INSERT trigger（enforce_signal_capital_limit）
 * 取到的 available_cash 就會反映前面已釋放的現金；
 * 讀者端排序是依 executed_at，不會受影響。
 *
 * `teaching_topic`/`overall_summary`/`learning_points` 仍掛在「原始 UI 第 1 筆」上，
 * 不是執行順序的第 1 筆，以保留分析師的敘事意圖。
 */
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
  const order = executionOrder(trades);
  return order.map((origIdx) => {
    const t = trades[origIdx];
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
      teaching_topic: origIdx === 0 && isMentor ? teachingTopic || null : null,
      overall_summary: origIdx === 0 && isMentor ? sanitizeRichHtml(overallSummary) || null : null,
      learning_points: origIdx === 0 && isMentor ? sanitizeRichHtml(learningPoints) || null : null,
      status: status as any,
    } as any;
  });
}

// 保留 OpenPosition 型別引用以避免未使用警告
export type { OpenPosition };
