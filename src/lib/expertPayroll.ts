/**
 * 老師月結薪資（純函式，無 IO）。
 *
 * 口徑：
 * - 歸月：付款成功時間（paid_at，缺漏退回 created_at）的台北月份；年繳整筆算在付款當月。
 * - 金額：revenue_splits.expert_amount，不重算比例。
 * - 退款：若原月份在退款當下尚未標記發放 → 直接從原月份扣除（不計入）。
 *   若已發放 → 列為「扣回」，進入 max(退款月份, 原月份+1)。
 * - 已標記發放的月份使用快照，數字不再變動。
 * - 應發為負數時，延續到下個月（carry）。
 */

export interface PayrollSplit {
  transaction_id: string;
  expert_id: string | null;
  expert_amount: number;
  net: number;
  platform_amount: number;
}
export interface PayrollTx {
  id: string;
  status: string;
  paid_at: string | null;
  created_at: string;
  subscription_id: string | null;
}
export interface PayoutLock {
  expert_id: string;
  period_month: string;
  status: string; // 'paid' | 'unmarked'
  paid_at: string | null;
  earnings: number;
  clawback: number;
  carry_in: number;
  amount: number;
  net: number;
  platform_amount: number;
  tx_count: number;
  student_count: number;
}
export interface ClawbackItem { transaction_id: string; amount: number; fromMonth: string }
export interface PayrollRow {
  expert_id: string;
  month: string;
  earnings: number;
  net: number;
  platform_amount: number;
  tx_count: number;
  student_count: number;
  clawback: number;
  clawbackItems: ClawbackItem[];
  carry_in: number;
  amount: number;
  locked: boolean;
  paid_at: string | null;
}

const TPE_OFFSET = 8 * 3600 * 1000;
export function taipeiMonth(iso: string): string {
  return new Date(new Date(iso).getTime() + TPE_OFFSET).toISOString().slice(0, 7);
}
export function nextMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
}
export function prevMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
}
/** 發放日：隔月 5 號。 */
export function payDate(m: string): string {
  return `${nextMonth(m).replace('-', '/')}/05`;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computePayroll(
  splits: PayrollSplit[],
  txs: PayrollTx[],
  refundAt: Record<string, string>,
  subUser: Record<string, string>,
  locks: PayoutLock[],
  upToMonth: string,
): Record<string, Record<string, PayrollRow>> {
  const txMap = new Map(txs.map((t) => [t.id, t]));
  const lockMap = new Map<string, PayoutLock>();
  for (const l of locks) if (l.status === 'paid') lockMap.set(`${l.expert_id}|${l.period_month}`, l);

  type Acc = { earnings: number; net: number; platform: number; tx: Set<string>; users: Set<string>; claw: ClawbackItem[] };
  const acc = new Map<string, Map<string, Acc>>();
  const get = (e: string, m: string) => {
    let em = acc.get(e); if (!em) acc.set(e, (em = new Map()));
    let a = em.get(m); if (!a) em.set(m, (a = { earnings: 0, net: 0, platform: 0, tx: new Set(), users: new Set(), claw: [] }));
    return a;
  };

  for (const s of splits) {
    if (!s.expert_id) continue;
    const t = txMap.get(s.transaction_id);
    if (!t) continue;
    const st = String(t.status);
    if (st !== 'paid' && st !== 'refunded') continue;
    const month = taipeiMonth(t.paid_at || t.created_at);
    const lock = lockMap.get(`${s.expert_id}|${month}`);
    if (st === 'refunded') {
      const rAt = refundAt[t.id];
      const lockedBeforeRefund = !!lock && (!rAt || !lock.paid_at || new Date(lock.paid_at) <= new Date(rAt));
      if (!lockedBeforeRefund) { get(s.expert_id, month); continue; } // 未發放 → 直接不計
      const rm = rAt ? taipeiMonth(rAt) : month;
      const target = rm > month ? rm : nextMonth(month);
      get(s.expert_id, target).claw.push({ transaction_id: t.id, amount: Number(s.expert_amount) || 0, fromMonth: month });
      // 原月份仍計入（已發放快照）
    }
    const a = get(s.expert_id, month);
    a.earnings += Number(s.expert_amount) || 0;
    a.net += Number(s.net) || 0;
    a.platform += Number(s.platform_amount) || 0;
    a.tx.add(t.id);
    const u = t.subscription_id ? subUser[t.subscription_id] : undefined;
    a.users.add(u || t.id);
  }
  for (const l of lockMap.values()) get(l.expert_id, l.period_month);

  const out: Record<string, Record<string, PayrollRow>> = {};
  for (const [expert, months] of acc) {
    const keys = [...months.keys()].sort();
    if (!keys.length) continue;
    out[expert] = {};
    let carry = 0;
    let m = keys[0];
    const end = upToMonth > keys[keys.length - 1] ? upToMonth : keys[keys.length - 1];
    while (m <= end) {
      const a = months.get(m);
      const lock = lockMap.get(`${expert}|${m}`);
      let row: PayrollRow;
      if (lock) {
        row = {
          expert_id: expert, month: m, earnings: Number(lock.earnings), net: Number(lock.net),
          platform_amount: Number(lock.platform_amount), tx_count: lock.tx_count, student_count: lock.student_count,
          clawback: Number(lock.clawback), clawbackItems: a?.claw ?? [], carry_in: Number(lock.carry_in),
          amount: Number(lock.amount), locked: true, paid_at: lock.paid_at,
        };
      } else {
        const claw = r2((a?.claw ?? []).reduce((s, c) => s + c.amount, 0));
        const earnings = r2(a?.earnings ?? 0);
        row = {
          expert_id: expert, month: m, earnings, net: r2(a?.net ?? 0), platform_amount: r2(a?.platform ?? 0),
          tx_count: a?.tx.size ?? 0, student_count: a?.users.size ?? 0, clawback: claw,
          clawbackItems: a?.claw ?? [], carry_in: r2(carry), amount: r2(earnings - claw + carry),
          locked: false, paid_at: null,
        };
      }
      out[expert][m] = row;
      carry = row.amount < 0 ? row.amount : 0;
      m = nextMonth(m);
    }
  }
  return out;
}
