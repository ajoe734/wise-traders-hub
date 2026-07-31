/**
 * holdingDetailViewModel — 持倉抽屜（HoldingsDetailPanel）的純推導層。
 *
 * 為什麼存在：抽屜原本是典型的淺模組——18 個 props 幾乎等於父層全部狀態，
 * 而真正的 bug 熱點（simInput 組裝、thesisRows、holdContext、目標價修正方向）
 * 都埋在 1354 行元件裡，只能靠視覺 e2e 間接覆蓋。
 *
 * 這裡把所有推導收斂成純函式：輸入資料、輸出 view-model，不碰 React、不碰 I/O。
 * 元件與 `useHoldingDetailViewModel` 只負責把資料餵進來、把結果畫出去。
 */

export const URGENCY_LABEL: Record<string, string> = {
  now: '立即', soon: '儘快', monitor: '觀察', low: '低',
};
export const ACTION_LABEL: Record<string, string> = {
  exit: '出場', review: '檢視', hold: '續抱',
};

const num = (v: any): number => Number(v);
const finite = (v: any): boolean => Number.isFinite(Number(v));

/** 識別區：代號、名稱、產業、策略、價格來源。 */
export function deriveIdentity(holding: any, meta: any) {
  const h = holding || {};
  return {
    code: h.code ?? null,
    name: h.name ?? null,
    industry: meta?.industry ?? null,
    strategy: meta?.strategy ?? null,
    priceSource: meta?.priceSource ?? null,
  };
}

/** 報酬塔的原始（未模擬）數值與市值／權重。 */
export function deriveValuation(holding: any, totalPortfolioValue: number) {
  const h = holding || {};
  const pctVal = h.pct ?? h.totalPct ?? 0;
  const pnlVal = num(h.pnl ?? h.totalPnl ?? 0) || 0;
  const todayPct = finite(h.changePct) ? num(h.changePct) : null;
  const todayPnl = finite(h.todayPnl) ? num(h.todayPnl) : null;
  const priceN = num(h.price);
  const qtyN = num(h.qty);
  const valueRaw = num(h.value);
  const valueNum = Number.isFinite(valueRaw)
    ? valueRaw
    : (Number.isFinite(priceN) && Number.isFinite(qtyN) ? priceN * qtyN : 0);
  const weightPct = totalPortfolioValue > 0 && valueNum > 0
    ? (valueNum / totalPortfolioValue) * 100
    : null;
  return { pctVal, pnlVal, todayPct, todayPnl, valueNum, weightPct };
}

export interface OHLC {
  open: number;
  high: number;
  low: number;
  close: number;
  date?: string;
}

export type SparklineData = number[] | { ohlc: OHLC[]; closes: number[] };

/** 從後端/快取格式取得 closes 陣列（向下相容 legacy number[]） */
export function getSparkCloses(data: SparklineData | undefined | null): number[] {
  if (Array.isArray(data)) return data.filter((n) => Number.isFinite(n));
  if (!data) return [];
  return Array.isArray(data.closes) ? data.closes.filter((n) => Number.isFinite(n)) : [];
}

/** 從後端/快取格式取得 OHLC 陣列（若無則回空） */
export function getSparkOhlc(data: SparklineData | undefined | null): OHLC[] {
  if (!data || Array.isArray(data)) return [];
  return Array.isArray(data.ohlc) ? data.ohlc.filter((b) =>
    Number.isFinite(b.open) && Number.isFinite(b.high) &&
    Number.isFinite(b.low) && Number.isFinite(b.close) && b.high > 0
  ) : [];
}

/** 30 日走勢 close 序列。真實資料不足 2 點時，以成本→現價的確定性偽序列補齊，
 * 保證同一檔股票每次 render 得到同一條線（seed 來自 code）。 */
export function deriveSparkline(sparkData30D: SparklineData | undefined | null, holding: any): number[] {
  const h = holding || {};
  const raw = getSparkCloses(sparkData30D);
  if (raw.length >= 2) return raw;
  const c = num(h.cost); const p = num(h.price);
  if (!Number.isFinite(c) || !Number.isFinite(p) || c <= 0 || p <= 0) return raw;
  const N = 30;
  const arr: number[] = [];
  const seed = String(h.code || 'x').split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const rand = (i: number) => {
    const x = Math.sin((seed + i) * 9973) * 10000;
    return x - Math.floor(x);
  };
  const amp = Math.max(Math.abs(p - c) * 0.35, p * 0.015);
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const base = c + (p - c) * t;
    arr.push(Number((base + (rand(i) - 0.5) * 2 * amp).toFixed(2)));
  }
  arr[N - 1] = p;
  return arr;
}

/** 由 close 序列產生確定性的偽 OHLC（demo／回補失敗時，抽屜仍以 K 棒呈現）。
 * seed 取自 code，同一檔股票每次 render 得到同一組 K 棒。 */
export function synthesizeOhlc(closes: number[], holding: any): OHLC[] {
  const arr = (Array.isArray(closes) ? closes : []).filter((n) => Number.isFinite(n));
  if (arr.length < 2) return [];
  const seed = String(holding?.code || 'x').split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const rand = (i: number) => {
    const x = Math.sin((seed + i * 7.13) * 4177) * 10000;
    return x - Math.floor(x);
  };
  const today = new Date();
  const n = arr.length;
  return arr.map((close, i) => {
    const open = i === 0 ? close * (1 + (rand(i) - 0.5) * 0.01) : arr[i - 1];
    const spread = Math.max(Math.abs(close - open), close * 0.004);
    const high = Math.max(open, close) + spread * (0.3 + rand(i + 100) * 0.7);
    const low = Math.min(open, close) - spread * (0.3 + rand(i + 200) * 0.7);
    const d = new Date(today);
    d.setDate(today.getDate() - (n - 1 - i));
    return {
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(Math.max(low, 0.01).toFixed(2)),
      close: Number(close.toFixed(2)),
      date: d.toISOString().slice(0, 10),
    };
  });
}

/** 30 日 OHLC 序列；真實資料不足時，用 close 序列合成確定性 K 棒。 */
export function deriveOhlc(
  sparkData30D: SparklineData | undefined | null,
  holding?: any,
  closesFallback?: number[],
): OHLC[] {
  const real = getSparkOhlc(sparkData30D);
  if (real.length >= 2) return real;
  if (!holding) return [];
  return synthesizeOhlc(closesFallback ?? getSparkCloses(sparkData30D), holding);
}


/** 論點引文：取第一個句子、上限 90 字。 */
export function deriveThesisSentence(dec: any, meta: any): string {
  const raw = dec?.actionText || meta?.strategy || '';
  if (!raw) return '';
  const m = String(raw).match(/^(.*?[。.!?！？])/);
  return (m ? m[1] : raw).slice(0, 90);
}

/** 與本檔相關的事件（排除 demo 來源），最多 5 筆。 */
export function deriveRelatedEvents(normalizedEvents: any, code: any) {
  return (Array.isArray(normalizedEvents) ? normalizedEvents : [])
    .filter((e: any) => (e?.relatedCodes || []).includes(code) && e?.source !== 'demo')
    .slice(0, 5);
}

/** 持有脈絡：持有天數、加碼次數、最近一次動作。無有效日期即回 null（整區隱藏）。 */
export function deriveHoldContext(tradeLog: any, code: any) {
  const logs = Array.isArray(tradeLog)
    ? tradeLog.filter((r: any) => r?.code === code || r?.stockCode === code)
    : [];
  if (!logs.length) return null;
  const withTs = logs
    .map((r: any) => {
      const ts = new Date(r?.date || r?.tradeDate || r?.createdAt || 0).getTime();
      return { r, ts: Number.isFinite(ts) && ts > 0 ? ts : 0 };
    })
    .filter((x) => x.ts > 0);
  if (!withTs.length) return null;
  const firstBuy = Math.min(...withTs.map((x) => x.ts));
  const heldDays = Math.max(0, Math.round((Date.now() - firstBuy) / 86400000));
  const addCount = logs.filter((r: any) =>
    /add|buy|加碼|買/i.test(String(r.action || r.actionType || ''))).length - 1;
  const lastEntry = [...withTs].sort((a, b) => b.ts - a.ts)[0];
  const lastAction = lastEntry?.r;
  const lastDate = new Date(lastEntry.ts);
  const lastLabel = !Number.isNaN(lastDate.getTime())
    ? `${lastDate.getMonth() + 1}/${lastDate.getDate()} ${String(lastAction.action || '')
        .replace(/add|buy/i, '加碼').replace(/reduce|sell/i, '減碼')}`
    : null;
  return { heldDays, addCount: Math.max(0, addCount), lastLabel };
}

/** 目標價修正方向；變動 <1% 視為未修正。 */
export function deriveTargetPriceTrend(targetPriceHistory: any, code: any) {
  const list = Array.isArray(targetPriceHistory?.[code]) ? targetPriceHistory[code] : null;
  if (!list || list.length < 2) return null;
  const sorted = [...list].sort(
    (a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const first = num(sorted[0]?.target);
  const last = num(sorted[sorted.length - 1]?.target);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return null;
  const deltaPct = ((last - first) / first) * 100;
  if (Math.abs(deltaPct) < 1) return null;
  return {
    last,
    deltaPct,
    arrow: deltaPct > 0 ? '↑' : '↓',
    from: first,
    spanDays: Math.round(
      (new Date(sorted[sorted.length - 1].date).getTime() - new Date(sorted[0].date).getTime())
      / 86400000),
  };
}

/** 決策履歷表格（最近 8 筆）。 */
export function deriveThesisRows(thesisTracking: any, code: any) {
  const list = Array.isArray(thesisTracking?.[code]) ? thesisTracking[code] : null;
  if (!list?.length) return null;
  return list.slice(-8).map((r: any) => ({
    date: r.date,
    suggestion: r.suggestion || r.action,
    myAction: r.myAction || r.userAction || '—',
    afterPct: finite(r.afterPct) ? num(r.afterPct) : null,
  }));
}

/** 建議印章行：操作分類與急迫度。 */
export function deriveDecisionStamp(dec: any) {
  const actionKind = dec?.actionType === 'exit' ? 'exit'
    : dec?.actionType === 'review' ? 'review' : 'hold';
  const urgencyKind = dec?.urgency === 'now' ? 'now'
    : dec?.urgency === 'soon' ? 'soon'
    : dec?.urgency === 'monitor' ? 'monitor' : 'low';
  return {
    actionKind,
    actionLabel: ACTION_LABEL[actionKind],
    urgencyKind,
    urgencyLabel: URGENCY_LABEL[urgencyKind],
    urgencyAccent: urgencyKind === 'now' || urgencyKind === 'soon',
  };
}

/** 前後檔導覽。 */
export function deriveNeighbors(orderedDisplayed: any, code: any) {
  const list = Array.isArray(orderedDisplayed) ? orderedDisplayed : [];
  const curIdx = list.findIndex((x: any) => x?.code === code);
  return {
    prev: curIdx > 0 ? list[curIdx - 1] : null,
    next: curIdx >= 0 && curIdx < list.length - 1 ? list[curIdx + 1] : null,
  };
}

/** 情境模擬輸入：空字串一律視為「沿用基準」而不是 0。 */
export function buildSimInput(holding: any, sim: any, baseTarget: any) {
  const h = holding || {};
  const s = sim || {};
  return {
    cost: num(h.cost) || 0,
    qty: num(h.qty) || 0,
    price: num(h.price) || 0,
    target: s.target === '' || s.target == null ? baseTarget : num(s.target),
    deltaQty: num(s.deltaQty) || 0,
    buyMorePrice: s.buyMorePrice === '' || s.buyMorePrice == null ? null : num(s.buyMorePrice),
    stopPrice: s.stopPrice === '' || s.stopPrice == null ? null : num(s.stopPrice),
  };
}

/** 模擬生效後實際要顯示的一組數字。 */
export function deriveDisplayNumbers(args: {
  holding: any; sim: any; scenario: any; dirty: boolean;
  baseTarget: any; valuation: ReturnType<typeof deriveValuation>;
  totalPortfolioValue: number;
}) {
  const { holding, sim, scenario, dirty, baseTarget, valuation, totalPortfolioValue } = args;
  const h = holding || {};
  const sc = scenario || {};
  const displayTarget = dirty && sim?.target !== '' && sim?.target != null
    ? num(sim.target) : baseTarget;
  const displayUpside = displayTarget && h.price
    ? ((displayTarget - h.price) / h.price * 100) : null;
  const displayPnlPct = dirty ? (sc.simPnlPct ?? valuation.pctVal) : valuation.pctVal;
  const displayPnlAbs = dirty ? (sc.simPnlAbs ?? valuation.pnlVal) : valuation.pnlVal;
  const displayQty = dirty ? sc.simQty : (num(h.qty) || 0);
  const displayValue = dirty ? sc.simValue : valuation.valueNum;
  const displayWeight = displayValue && totalPortfolioValue
    ? (displayValue / totalPortfolioValue) * 100
    : valuation.weightPct;
  return { displayTarget, displayUpside, displayPnlPct, displayPnlAbs, displayQty, displayValue, displayWeight };
}

/** hook 端把後端列攤平成抽屜要的 `{ [code]: rows }` 形狀。 */
export function shapeTargetPriceHistory(rows: any, code: any) {
  if (!code || !Array.isArray(rows) || rows.length === 0) return null;
  const shaped = rows
    .map((r: any) => ({
      date: r?.report_date || (r?.created_at ? String(r.created_at).slice(0, 10) : null),
      target: num(r?.target),
    }))
    .filter((r) => r.date && Number.isFinite(r.target) && r.target > 0);
  return shaped.length ? { [code]: shaped } : null;
}

export function shapeThesisTracking(theses: any, code: any) {
  if (!code || !Array.isArray(theses) || theses.length === 0) return null;
  const forCode = theses.filter((t: any) => t?.stockId === code || t?.code === code);
  if (!forCode.length) return null;
  const rows: any[] = [];
  for (const t of forCode) {
    const history = Array.isArray(t?.reviewHistory) ? t.reviewHistory : [];
    for (const r of history) {
      const rawDate = r?.timestamp || r?.date || r?.createdAt;
      if (!rawDate) continue;
      rows.push({
        date: String(rawDate).slice(0, 10),
        suggestion: r?.suggestion || r?.action || r?.decision || '—',
        myAction: r?.myAction || r?.userAction || '—',
        afterPct: finite(r?.afterPct) ? num(r.afterPct) : null,
      });
    }
  }
  if (!rows.length) return null;
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { [code]: rows };
}

/** 抽屜頁腳／匯出卡用的時間戳（本地時間，YYYY/MM/DD HH:mm）。 */
export function formatStamp(now: Date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
export function formatTodayLabel(now: Date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(now.getMonth() + 1)}／${pad(now.getDate())}`;
}

/**
 * 抽屜 view-model 的單一入口：一次算完所有純推導區塊。
 * 情境模擬（sim state / scenario / dirty）由 hook 注入，因為它有 React 狀態。
 */
export function deriveHoldingDetailViewModel(input: {
  holding: any;
  decision?: any;
  meta?: any;
  baseTarget?: any;
  totalPortfolioValue?: number;
  sparkData30D?: SparklineData;
  normalizedEvents?: any;
  orderedDisplayed?: any;
  tradeLog?: any;
  targetPriceHistory?: any;
  thesisTracking?: any;
  sim?: any;
  scenario?: any;
  dirty?: boolean;
  now?: Date;
}) {
  const {
    holding, decision = null, meta = null, baseTarget = null,
    totalPortfolioValue = 0, sparkData30D = [], normalizedEvents = [],
    orderedDisplayed = [], tradeLog = null, targetPriceHistory = null,
    thesisTracking = null, sim = null, scenario = null, dirty = false, now,
  } = input;
  const code = holding?.code ?? null;
  const valuation = deriveValuation(holding, totalPortfolioValue);
  const sparkArr = deriveSparkline(sparkData30D, holding);
  const ohlcArr = deriveOhlc(sparkData30D);
  const relatedEvents = deriveRelatedEvents(normalizedEvents, code);
  const display = deriveDisplayNumbers({
    holding, sim, scenario, dirty, baseTarget, valuation, totalPortfolioValue,
  });
  return {
    identity: deriveIdentity(holding, meta),
    valuation,
    sparkArr,
    ohlcArr,
    rangeLow: sparkArr.length ? Math.min(...sparkArr) : null,
    rangeHigh: sparkArr.length ? Math.max(...sparkArr) : null,
    ohlcRangeLow: ohlcArr.length ? Math.min(...ohlcArr.map((b) => b.low)) : null,
    ohlcRangeHigh: ohlcArr.length ? Math.max(...ohlcArr.map((b) => b.high)) : null,
    thesisSentence: deriveThesisSentence(decision, meta),
    relatedEvents,
    nextEvent: relatedEvents[0] ?? null,
    holdContext: deriveHoldContext(tradeLog, code),
    tpHistory: deriveTargetPriceTrend(targetPriceHistory, code),
    thesisRows: deriveThesisRows(thesisTracking, code),
    decisionStamp: deriveDecisionStamp(decision),
    neighbors: deriveNeighbors(orderedDisplayed, code),
    display,
    stamp: formatStamp(now),
    todayLabel: formatTodayLabel(now),
  };
}

export type HoldingDetailViewModel = ReturnType<typeof deriveHoldingDetailViewModel>;
