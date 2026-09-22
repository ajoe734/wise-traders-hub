/**
 * 訂閱付款彙總（純函式，無 IO）。
 *
 * 背景：訂閱者表格原本只顯示「起始日／到期日」。當 `member_subscriptions.started_at`
 * 被補成比實際付款日更早的日期（手動開通、補登舊訂閱），畫面就會出現
 * 「7/27 起算、9/06 到期」這種看起來不足月的區間，實際上到期日是以付款日 + 一期計算的。
 *
 * 這裡提供：
 * - 依 subscription id 索引已付款紀錄
 * - 一個群組（同一人同一老師的多期）的首次／最近付款時間與金額
 * - 起始日與首筆付款日的落差天數，讓表格可以直接標示出來
 */

export interface PaymentRow {
  subscription_id: string | null;
  amount: number | null;
  status: string | null;
  paid_at: string | null;
  created_at: string | null;
}

export interface PaymentRecord {
  subscription_id: string;
  amount: number;
  paid_at: string;
}

/** 起始日與付款日差幾天才值得提示（避免時區、幾小時的正常誤差被標成異常）。 */
export const START_PAYMENT_GAP_THRESHOLD_DAYS = 3;

const DAY = 24 * 60 * 60 * 1000;
const ts = (v: string | null | undefined) => (v ? new Date(v).getTime() : NaN);

/** 只取真正付款成功的紀錄；paid_at 缺漏時退回 created_at。 */
export function buildPaymentIndex(rows: PaymentRow[]): Record<string, PaymentRecord[]> {
  const out: Record<string, PaymentRecord[]> = {};
  for (const r of rows) {
    if (!r.subscription_id) continue;
    if ((r.status || '').toLowerCase() !== 'paid') continue;
    const at = r.paid_at || r.created_at;
    if (!at || !Number.isFinite(ts(at))) continue;
    const bucket = out[r.subscription_id] || (out[r.subscription_id] = []);
    bucket.push({ subscription_id: r.subscription_id, amount: Number(r.amount || 0), paid_at: at });
  }
  for (const list of Object.values(out)) list.sort((a, b) => ts(a.paid_at) - ts(b.paid_at));
  return out;
}

export interface PaymentSummary {
  count: number;
  firstPaidAt: string | null;
  lastPaidAt: string | null;
  lastAmount: number | null;
  totalAmount: number;
}

const EMPTY_SUMMARY: PaymentSummary = {
  count: 0, firstPaidAt: null, lastPaidAt: null, lastAmount: null, totalAmount: 0,
};

/** 單一期間（一列訂閱）的付款摘要。 */
export function paymentsForSpell(
  index: Record<string, PaymentRecord[]>,
  subscriptionId: string | null | undefined,
): PaymentSummary {
  const list = (subscriptionId && index[subscriptionId]) || [];
  return summarise(list);
}

/** 一個群組（多期）的付款摘要：首次付款、最近付款、累計金額。 */
export function paymentsForGroup(
  index: Record<string, PaymentRecord[]>,
  subscriptionIds: Array<string | null | undefined>,
): PaymentSummary {
  const list: PaymentRecord[] = [];
  for (const id of subscriptionIds) {
    if (id && index[id]) list.push(...index[id]);
  }
  list.sort((a, b) => ts(a.paid_at) - ts(b.paid_at));
  return summarise(list);
}

function summarise(list: PaymentRecord[]): PaymentSummary {
  if (list.length === 0) return EMPTY_SUMMARY;
  const last = list[list.length - 1];
  return {
    count: list.length,
    firstPaidAt: list[0].paid_at,
    lastPaidAt: last.paid_at,
    lastAmount: last.amount,
    totalAmount: list.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0),
  };
}

/**
 * 起始日與首筆付款日的落差天數（正值＝起始日早於付款日）。
 * 兩者任一缺漏回傳 null。
 */
export function startPaymentGapDays(
  startedAt: string | null | undefined,
  firstPaidAt: string | null | undefined,
): number | null {
  const s = ts(startedAt);
  const p = ts(firstPaidAt);
  if (!Number.isFinite(s) || !Number.isFinite(p)) return null;
  return Math.round((p - s) / DAY);
}

/**
 * 表格提示文字：落差超過門檻才提示，避免噪音。
 * 回傳 null 代表不需要提示。
 */
export function startPaymentGapHint(
  startedAt: string | null | undefined,
  firstPaidAt: string | null | undefined,
  thresholdDays: number = START_PAYMENT_GAP_THRESHOLD_DAYS,
): { days: number; label: string; title: string } | null {
  const gap = startPaymentGapDays(startedAt, firstPaidAt);
  if (gap == null || Math.abs(gap) < thresholdDays) return null;
  const abs = Math.abs(gap);
  const earlier = gap > 0 ? '起始日早於付款日' : '起始日晚於付款日';
  return {
    days: gap,
    label: `起始日與付款日差 ${abs} 天`,
    title: `${earlier} ${abs} 天。到期日是以付款日起算一期，表格上的起始日僅為開通時填寫的值。`,
  };
}
