/**
 * 老師月結薪資（純函式，無 IO）。
 *
 * 口徑：
 * - 歸月：服務期滿月。期滿日 = 付款日（paid_at，缺漏退回 created_at）+ 週期，
 *   不看訂閱紀錄上被手動延長的到期日。月繳 1 期；年繳拆 12 期，每期 = 分潤/12（尾差放最後一期），
 *   每期計入其滿期日的台北月份。
 * - 金額：revenue_splits.expert_amount，不重算比例。
 * - 退款：還沒滿期的期數不計入（金流商部分退款依比例縮減未滿期期數）；已滿期的不扣回。
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
  /** 金額；退款紀錄為負值（金流商退款會另插一筆負額 refunded 交易）。 */
  amount?: number | null;
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
  clawback_items?: ClawbackItem[] | null;
}
export interface ClawbackItem { transaction_id: string; amount: number; fromMonth: string; refundMonth?: string }
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
  items: RecognitionItem[];
}
export interface RecognitionItem { transaction_id: string; subscription_id: string | null; paid_at: string; end_at: string; k: number; n: number; amount: number; cycleUnknown: boolean }

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

/** 台北日期 + n 個月（月底夾住），回傳 ISO。 */
export function addMonthsTaipei(iso: string, n: number): string {
  const d = new Date(new Date(iso).getTime() + TPE_OFFSET);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const t = Date.UTC(y, m, Math.min(day, last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
  return new Date(t - TPE_OFFSET).toISOString();
}

export function cycleInstallments(cycle: string | null | undefined): { n: number; unknown: boolean } {
  const c = String(cycle || '').toLowerCase();
  if (/year|annual/.test(c)) return { n: 12, unknown: false };
  if (/month/.test(c)) return { n: 1, unknown: false };
  return { n: 1, unknown: true };
}

/** 一筆分潤的認列排程。cutoff 之後滿期的期數乘上 keepRatio（0 = 全不計）。 */
export function recognitionSchedule(
  txId: string, subId: string | null, paidIso: string, amount: number, cycle: string | null | undefined,
  cutoffIso: string | null = null, keepRatio = 0,
): RecognitionItem[] {
  const { n, unknown } = cycleInstallments(cycle);
  const per = r2(amount / n);
  const out: RecognitionItem[] = [];
  for (let k = 1; k <= n; k++) {
    const end = addMonthsTaipei(paidIso, k);
    let amt = k === n ? r2(amount - per * (n - 1)) : per;
    if (cutoffIso && new Date(end) > new Date(cutoffIso)) amt = r2(amt * keepRatio);
    if (amt === 0) continue;
    out.push({ transaction_id: txId, subscription_id: subId, paid_at: paidIso, end_at: end, k, n, amount: amt, cycleUnknown: unknown });
  }
  return out;
}

export function computePayroll(
  splits: PayrollSplit[],
  txs: PayrollTx[],
  refundAt: Record<string, string>,
  subUser: Record<string, string>,
  locks: PayoutLock[],
  upToMonth: string,
  subCycle: Record<string, string> = {},
): Record<string, Record<string, PayrollRow>> {
  const lockMap = new Map<string, PayoutLock>();
  for (const l of locks) if (l.status === 'paid') lockMap.set(`${l.expert_id}|${l.period_month}`, l);

  type Acc = { earnings: number; net: number; platform: number; tx: Set<string>; users: Set<string>; items: RecognitionItem[] };
  const acc = new Map<string, Map<string, Acc>>();
  const get = (e: string, m: string) => {
    let em = acc.get(e); if (!em) acc.set(e, (em = new Map()));
    let a = em.get(m); if (!a) em.set(m, (a = { earnings: 0, net: 0, platform: 0, tx: new Set(), users: new Set(), items: [] }));
    return a;
  };

  // 金流商負額退款：依同訂閱最近一筆已付款原交易。
  const splitTx = new Set(splits.filter((s) => s.expert_id).map((s) => s.transaction_id));
  const providerRefund = new Map<string, { at: string; amount: number }>();
  for (const t of txs) {
    if (String(t.status) !== 'refunded' || !(Number(t.amount) < 0) || !t.subscription_id || splitTx.has(t.id)) continue;
    const rAt = t.paid_at || t.created_at;
    const orig = txs
      .filter((o) => o.subscription_id === t.subscription_id && String(o.status) === 'paid' && splitTx.has(o.id)
        && new Date(o.paid_at || o.created_at) <= new Date(rAt))
      .sort((a, b) => (b.paid_at || b.created_at).localeCompare(a.paid_at || a.created_at))[0];
    if (!orig) continue;
    const prev = providerRefund.get(orig.id);
    providerRefund.set(orig.id, { at: prev && prev.at < rAt ? prev.at : rAt, amount: (prev?.amount ?? 0) + Math.abs(Number(t.amount)) });
  }
  const txMap = new Map(txs.map((t) => [t.id, t]));

  for (const s of splits) {
    if (!s.expert_id) continue;
    const t = txMap.get(s.transaction_id);
    if (!t) continue;
    const st = String(t.status);
    if (st !== 'paid' && st !== 'refunded') continue;
    const paidIso = t.paid_at || t.created_at;
    const exp = Number(s.expert_amount) || 0;
    const cycle = t.subscription_id ? subCycle[t.subscription_id] : undefined;
    const { n } = cycleInstallments(cycle);
    let cutoff: string | null = null, keep = 0;
    if (st === 'refunded') {
      cutoff = refundAt[t.id] || paidIso;
    } else {
      const pr = providerRefund.get(t.id);
      if (pr) {
        cutoff = pr.at;
        const base = Math.abs(Number(t.amount) || 0);
        const matured = Array.from({ length: n }, (_, i) => addMonthsTaipei(paidIso, i + 1)).filter((e) => new Date(e) <= new Date(pr.at)).length;
        const unmaturedBase = base * (n - matured) / n;
        keep = unmaturedBase > 0 ? Math.max(0, 1 - pr.amount / unmaturedBase) : 0;
      }
    }
    const items = recognitionSchedule(t.id, t.subscription_id, paidIso, exp, cycle, cutoff, keep);
    const ratio = exp ? 1 / exp : 0;
    for (const it of items) {
      const month = taipeiMonth(it.end_at);
      if (lockMap.has(`${s.expert_id}|${month}`)) { get(s.expert_id, month); continue; }
      const a = get(s.expert_id, month);
      a.earnings += it.amount;
      a.net += (Number(s.net) || 0) * it.amount * ratio;
      a.platform += (Number(s.platform_amount) || 0) * it.amount * ratio;
      a.tx.add(t.id);
      const u = t.subscription_id ? subUser[t.subscription_id] : undefined;
      a.users.add(u || t.id);
      a.items.push(it);
    }
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
          clawback: Number(lock.clawback), clawbackItems: lock.clawback_items ?? [], carry_in: Number(lock.carry_in),
          amount: Number(lock.amount), locked: true, paid_at: lock.paid_at, items: [],
        };
      } else {
        const earnings = r2(a?.earnings ?? 0);
        row = {
          expert_id: expert, month: m, earnings, net: r2(a?.net ?? 0), platform_amount: r2(a?.platform ?? 0),
          tx_count: a?.tx.size ?? 0, student_count: a?.users.size ?? 0, clawback: 0,
          clawbackItems: [], carry_in: r2(carry), amount: r2(earnings + carry),
          locked: false, paid_at: null, items: (a?.items ?? []).sort((x, y) => x.end_at.localeCompare(y.end_at)),
        };
      }
      out[expert][m] = row;
      carry = row.amount < 0 ? row.amount : 0;
      m = nextMonth(m);
    }
  }
  return out;
}
