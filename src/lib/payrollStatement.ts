/**
 * 月結薪資輸入整理（純函式）。管理員「月結薪資」與老師「對帳明細」共用，
 * 確保兩邊的「本月前 20 筆不抽成」排除名單與名字對照完全相同。
 */
export interface PayrollRaw {
  splits: any[];
  txs: any[];
  subs: any[];
  experts: any[];
  locks: any[];
  refundLogs: { target_id: string | null; created_at: string }[];
  profiles: { user_id: string; display_name: string | null; is_tester: boolean | null }[];
  plans: { id: string; name: string }[];
}

export function preparePayrollData(raw: PayrollRaw) {
  const refundAt: Record<string, string> = {};
  for (const a of raw.refundLogs) if (a.target_id && (!refundAt[a.target_id] || a.created_at < refundAt[a.target_id])) refundAt[a.target_id] = a.created_at;
  const subUser: Record<string, string> = {};
  const subCycle: Record<string, string> = {};
  const subPlan: Record<string, string> = {};
  for (const s of raw.subs) { subUser[s.id] = s.user_id; subCycle[s.id] = s.billing_cycle; subPlan[s.id] = s.plan_id; }
  const names: Record<string, string> = Object.fromEntries(raw.profiles.map((p) => [p.user_id, p.display_name || '']));
  const planNames: Record<string, string> = Object.fromEntries(raw.plans.map((p) => [p.id, p.name]));
  const testers = new Set<string>(raw.profiles.filter((p) => p.is_tester).map((p) => p.user_id));
  // 不佔「每月前 20 筆」名額：健檢分潤、測試帳號。
  const excludedTx = new Set<string>();
  for (const s of raw.splits) if (s.rule_source === 'checkup_default') excludedTx.add(s.transaction_id);
  for (const t of raw.txs) if (t.subscription_id && testers.has(subUser[t.subscription_id])) excludedTx.add(t.id);
  return { subPlan, names, planNames, excludedTx, subCycle, splits: raw.splits, txs: raw.txs, refundAt, subUser, experts: raw.experts, locks: raw.locks };
}
