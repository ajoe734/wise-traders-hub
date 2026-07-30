import { simulatePositions, type TradeAction } from '@/lib/simulatePositions';
import {
  normalizeSignalQuantityToShares,
  calcWeightedAvgPrice,
} from '@/lib/signalTradeLogic';
import {
  type CapitalStatus, type OpenPosition, type TradeDraft,
} from './types';
import { getActionMeta } from '@/lib/signalAction';
import { sanitizeRichHtml } from '@/lib/sanitizeHtml';
import {
  formatMoneyByCurrency,
  type Currency,
} from '@/lib/currency';
import {
  getAssetSpec,
  isValidAssetSymbol,
  resolveAssetClass,
  sanitizeAssetQuantityUnit,
  type AssetClass,
} from '@/lib/asset';
import { formatBaseQuantity } from '@/lib/positionQuantity';
import {
  analyzeCombo,
  buildOccSymbol,
  detectComboStrategy,
  formatComboLabel,
  validateCombo,
  OPTION_CONTRACT_MULTIPLIER,
  type ComboLeg,
} from '@/lib/optionCombo';

/**
 * 一「單位」部位所佔用的資金（以 base quantity 為 1 計）。
 *
 * - 一般標的：參考價
 * - 美股單腿選擇權：參考價 × 100（合約乘數）
 * - 美股組合單：每組最大損失（風險即佔用資金），與 DB trigger
 *   `enforce_signal_capital_limit` 的 combo 分支完全一致。
 */
export function effectiveUnitCost(
  t: TradeDraft,
  assetClass: AssetClass | string | null | undefined,
): number {
  if (t.isCombo && (t.legs?.length || 0) >= 2) {
    const m = analyzeCombo(t.legs as ComboLeg[]);
    return m.maxLossPerUnit ?? 0;
  }
  const price = parseFloat(t.priceHint || '0') || 0;
  return String(assetClass) === 'us_option' ? price * OPTION_CONTRACT_MULTIPLIER : price;
}

function capitalAssetClass(capital: CapitalStatus | null): AssetClass | string {
  return (capital?.asset_class as string) || 'tw_stock';
}


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
  hold: 5,
  teaching: 6,
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
    const price = effectiveUnitCost(t, capitalAssetClass(capital));
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
    const price = effectiveUnitCost(t, capitalAssetClass(capital));
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
 *
 * C8：本函式**不再**自行維護模擬狀態，一律呼叫 `buildStepStates`
 * 與 `computeCashSim`，避免三份模擬各走各的。錯誤訊息中的「第 N 檔」
 * 沿用**原始 UI index**，讓分析師能在卡片上找到對應那張。
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

  const assetClass = resolveAssetClass(expert);
  const spec = getAssetSpec(assetClass);
  const currency: Currency = spec.currency;
  const fmt = (n: number) => formatMoneyByCurrency(n, currency);

  // ── 先做欄位完整性檢查（依原始 UI 順序，先填好再排序執行） ──
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const tag = `第 ${i + 1} 檔`;
    if (t.isCombo) {
      if (assetClass !== 'us_option') return `${tag}：只有美股選擇權可以使用組合單`;
      const r = validateCombo((t.legs || []) as ComboLeg[]);
      if (!r.ok) return `${tag}：${r.error}`;
    } else {
      if (!t.stockCode.trim()) return `${tag}：請填股票代碼`;
      if (!isValidAssetSymbol(t.stockCode.trim().toUpperCase(), assetClass)) {
        return `${tag}：標的代碼格式錯誤（${spec.symbolPlaceholder}）`;
      }
    }
    if (!spec.units.includes(t.quantityUnit as any)) {
      return `${tag}：${spec.label}單位只能用「${spec.units.join(' / ')}」，不能使用「${t.quantityUnit}」`;
    }
    if (!t.action) return `${tag}：請選操作方向`;
    if (!t.executedAt) return `${tag}：請填操作時間`;
    // hold = 本週只觀察既有持倉，不進出場：數量/價格可省略
    if (t.action === 'hold') continue;
    const qty = parseInt(t.quantity || '0', 10);
    if (!qty || qty <= 0) return `${tag}：請填${t.isCombo ? '組數' : '數量'}`;
    if (!t.isCombo) {
      const price = parseFloat(t.priceHint || '0');
      if (!price || price <= 0) return `${tag}：請填參考價格`;
    }
  }

  // ── C8：統一模擬狀態源 ──
  const { perTradeBefore } = buildStepStates(trades, capital);
  const { perTrade: cashBefore } = computeCashSim(trades, capital);
  const order = executionOrder(trades);

  for (const i of order) {
    const t = trades[i];
    const tag = `第 ${i + 1} 檔（${getActionMeta(t.action).label}）`;
    const price = effectiveUnitCost(t, assetClass);
    const shares = normalizeSignalQuantityToShares(
      parseInt(t.quantity || '0', 10) || 0,
      t.quantityUnit,
    );
    const cur = perTradeBefore[i] || { qty: 0, avg: 0 };
    const remaining = cashBefore[i] ?? (capital?.available_cash || 0);
    const fmtQty = (sh: number, unit = t.quantityUnit) =>
      formatBaseQuantity(sh, unit, assetClass);

    if (t.action === 'hold') {
      if (cur.qty <= 0) {
        return `${tag}：尚無 ${t.stockCode.trim()} 的未平倉部位，無法寫「觀察」週記（請改用「買進」或選其他既有持倉）`;
      }
      continue;
    }

    if (t.action === 'trim' || t.action === 'sell' || t.action === 'exit') {
      if (cur.qty <= 0) {
        return `${tag}：目前模擬持倉為 0，無法執行${getActionMeta(t.action).label}（請改用「買進」或調整前面幾筆）`;
      }
      if ((t.action === 'trim' || t.action === 'sell') && shares > cur.qty) {
        return `${tag}：${getActionMeta(t.action).label}數量 (${fmtQty(shares)}) 超過目前模擬持倉 (${fmtQty(cur.qty)})`;
      }
    }


    if (t.action === 'buy' || t.action === 'add') {
      const required = price * shares;
      if (required > remaining) {
        return `${tag}：本筆需 ${fmt(required)}，扣除同批減碼／平倉釋放的資金後可用現金僅 ${fmt(remaining)}，已超過操作金額上限`;
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// B2 — 輸入當下的單位／方向／資金檢查（非送出後）
// ─────────────────────────────────────────────────────────────

export type TradeIssueCode =
  | 'UNIT_MIX'
  | 'DIRECTION_OVERSELL'
  | 'DIRECTION_NO_POSITION'
  | 'CAPITAL_EXCEEDED';

export interface TradeIssue {
  /** 對齊原始 UI 的 trades index */
  index: number;
  field: 'quantity' | 'quantityUnit' | 'action' | 'priceHint';
  code: TradeIssueCode;
  message: string;
}

/**
 * 即時（輸入當下）逐筆檢查，**只回報已經填夠資料才能判定的問題**：
 * 單位不合資產類別、賣超模擬持倉、無持倉卻要減碼／平倉、超過可用現金。
 *
 * 欄位缺漏（沒填代碼／價格等）不在此回報，避免打字途中就滿江紅；
 * 那些仍由送出時的 `validateSignalBatch` 負責。
 */
export function collectTradeIssues(args: {
  expert: any;
  trades: TradeDraft[];
  capital: CapitalStatus | null;
}): TradeIssue[] {
  const { expert, trades, capital } = args;
  if (!expert || !Array.isArray(trades) || trades.length === 0) return [];

  const assetClass = resolveAssetClass(expert);
  const spec = getAssetSpec(assetClass);
  const currency: Currency = spec.currency;
  const fmt = (n: number) => formatMoneyByCurrency(n, currency);

  const issues: TradeIssue[] = [];

  // 單位檢查與其他狀態無關，逐筆立即可判
  trades.forEach((t, index) => {
    if (!t.quantityUnit) return;
    if (t.isCombo) {
      if (t.quantityUnit !== '組') {
        issues.push({
          index,
          field: 'quantityUnit',
          code: 'UNIT_MIX',
          message: `組合單只能用「組」為單位，不能使用「${t.quantityUnit}」`,
        });
      }
      return;
    }
    if (!spec.units.includes(t.quantityUnit as any)) {
      issues.push({
        index,
        field: 'quantityUnit',
        code: 'UNIT_MIX',
        message: `${spec.label}單位只能用「${spec.units.join(' / ')}」，不能使用「${t.quantityUnit}」`,
      });
    }
  });

  const { perTradeBefore } = buildStepStates(trades, capital);
  const { perTrade: cashBefore } = computeCashSim(trades, capital);

  for (const i of executionOrder(trades)) {
    const t = trades[i];
    const code = (t.stockCode || '').trim();
    const qtyInput = parseInt(t.quantity || '0', 10) || 0;
    if (!code || !t.action || t.action === 'hold' || t.action === 'teaching') continue;
    if (qtyInput <= 0) continue;

    const shares = normalizeSignalQuantityToShares(qtyInput, t.quantityUnit);
    const cur = perTradeBefore[i] || { qty: 0, avg: 0 };
    const fmtQty = (sh: number) => formatBaseQuantity(sh, t.quantityUnit, assetClass);

    if (t.action === 'trim' || t.action === 'sell' || t.action === 'exit') {
      if (cur.qty <= 0) {
        issues.push({
          index: i,
          field: 'action',
          code: 'DIRECTION_NO_POSITION',
          message: `目前模擬持倉為 0，無法執行${getActionMeta(t.action).label}`,
        });
        continue;
      }
      if ((t.action === 'trim' || t.action === 'sell') && shares > cur.qty) {
        issues.push({
          index: i,
          field: 'quantity',
          code: 'DIRECTION_OVERSELL',
          message: `${getActionMeta(t.action).label}數量 (${fmtQty(shares)}) 超過目前模擬持倉 (${fmtQty(cur.qty)})`,
        });
      }
      continue;
    }

    if (t.action === 'buy' || t.action === 'add') {
      const unitCost = effectiveUnitCost(t, assetClass);
      if (unitCost <= 0) continue;
      const required = unitCost * shares;
      const remaining = cashBefore[i] ?? (capital?.available_cash || 0);
      if (required > remaining) {
        issues.push({
          index: i,
          field: 'quantity',
          code: 'CAPITAL_EXCEEDED',
          message: `本筆需 ${fmt(required)}，可用現金僅 ${fmt(remaining)}`,
        });
      }
    }
  }

  return issues.sort((a, b) => a.index - b.index);
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
  assetClass?: AssetClass | string | null;
  isMentor: boolean;
  teachingTopic: string;
  overallSummary: string;
  learningPoints: string;
  trades: TradeDraft[];
}) {
  const { expertId, batchId, status, assetClass, isMentor, teachingTopic, overallSummary, learningPoints, trades } = args;
  const safeAssetClass = assetClass || 'tw_stock';
  const order = executionOrder(trades);
  return order.map((origIdx) => {
    const t = trades[origIdx];
    const isCombo = !!t.isCombo && (t.legs?.length || 0) >= 2;
    const comboMetrics = isCombo ? analyzeCombo(t.legs as ComboLeg[]) : null;
    const quantityUnit = isCombo
      ? ('組' as const)
      : sanitizeAssetQuantityUnit(t.quantityUnit, safeAssetClass);
    const instrument = isCombo
      ? formatComboLabel(t.legs as ComboLeg[])
      : (t.stockName.trim()
        ? `${t.stockCode.trim()} ${t.stockName.trim()}`
        : t.stockCode.trim());
    const isHold = t.action === 'hold';
    const priceHint = t.priceHint && parseFloat(t.priceHint) > 0 ? parseFloat(t.priceHint) : null;
    const quantity = t.quantity && parseInt(t.quantity, 10) > 0 ? parseInt(t.quantity, 10) : null;
    // 組合單：price_hint 存「每股等值成本」＝ 每組最大損失 / 100，
    // 讓下游 price × 口數 × 100 的成本計算與佔用資金一致。
    const comboPriceHint = comboMetrics
      ? Math.round(((comboMetrics.maxLossPerUnit || 0) / OPTION_CONTRACT_MULTIPLIER) * 10000) / 10000
      : null;
    return {
      id: (globalThis.crypto?.randomUUID?.() ?? undefined) as any,
      expert_id: expertId,
      plan_id: null,
      batch_id: batchId,
      instrument,
      action: t.action as any,
      price_hint: isCombo ? comboPriceHint : (isHold ? priceHint : parseFloat(t.priceHint)),
      is_combo: isCombo,
      combo_strategy: isCombo ? (t.comboStrategy || detectComboStrategy(t.legs as ComboLeg[])) : null,
      net_premium: comboMetrics ? comboMetrics.netPremium : null,
      max_loss_per_unit: comboMetrics ? comboMetrics.maxLossPerUnit : null,
      quantity: isHold ? quantity : parseInt(t.quantity, 10),
      quantity_unit: isHold && !quantity ? null : quantityUnit,
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

/**
 * 純教學週記：不帶任何交易，只送單一一筆 expert_signals（action='teaching'）。
 * instrument 用空白字串以滿足 NOT NULL，trigger 對 'teaching' 無動作。
 */
export function buildTeachingOnlyRow(args: {
  expertId: string;
  batchId: string;
  status: string;
  teachingTopic: string;
  overallSummary: string;
  learningPoints: string;
}) {
  const { expertId, batchId, status, teachingTopic, overallSummary, learningPoints } = args;
  return [{
    expert_id: expertId,
    plan_id: null,
    batch_id: batchId,
    instrument: '',
    action: 'teaching' as any,
    price_hint: null,
    quantity: null,
    quantity_unit: null,
    executed_at: new Date().toISOString(),
    reason_summary: null,
    reason_detail: null,
    risk_notes: null,
    teaching_topic: teachingTopic || null,
    overall_summary: sanitizeRichHtml(overallSummary) || null,
    learning_points: sanitizeRichHtml(learningPoints) || null,
    status: status as any,
  } as any];
}

/**
 * 把 combo trades 轉成 expert_signal_legs insert payload。
 * rows 需與 `buildPublishRows` 的輸出對齊（同樣帶著 client 生成的 id）。
 */
export function buildComboLegRows(rows: any[], trades: TradeDraft[]) {
  const byInstrument = new Map<string, TradeDraft>();
  trades.forEach((t) => {
    if (t.isCombo && (t.legs?.length || 0) >= 2) {
      byInstrument.set(formatComboLabel(t.legs as ComboLeg[]), t);
    }
  });
  const out: any[] = [];
  rows.forEach((r) => {
    if (!r?.is_combo) return;
    const t = byInstrument.get(r.instrument);
    if (!t) return;
    (t.legs as ComboLeg[]).forEach((l, i) => {
      out.push({
        signal_id: r.id,
        leg_index: i,
        occ_symbol: buildOccSymbol(l),
        underlying: String(l.underlying || '').trim().toUpperCase(),
        expiry: l.expiry,
        right_type: l.right,
        strike: Number(l.strike),
        side: l.side,
        ratio: Math.max(1, Number(l.ratio || 1)),
        leg_price: Number(l.price),
      });
    });
  });
  return out;
}

// 保留 OpenPosition 型別引用以避免未使用警告
export type { OpenPosition };
