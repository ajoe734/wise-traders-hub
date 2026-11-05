/**
 * 後台「有效學員」單一定義（純函式，無 IO）。
 * 有效 = status active 且未過期（無到期日視為有效）；依人去重；
 * 排除老師本人與測試帳號；該人在此老師名下無任何已付款訂閱 → 歸「未付款／贈送」。
 * 同一人同時有年繳與月繳時，以年繳計入週期小計。
 */
export interface ActiveSubInput {
  id: string;
  user_id: string;
  expert_id: string | null;
  status: string;
  billing_cycle: string | null;
  expires_at: string | null;
}

export interface ActiveSubscriberSummary {
  paidUsers: string[];
  unpaidUsers: string[];
  yearly: number;
  monthly: number;
}

export function isActiveSub(s: { status: string; expires_at: string | null }, nowMs: number): boolean {
  return s.status === 'active' && (!s.expires_at || new Date(s.expires_at).getTime() > nowMs);
}

export function summarizeActiveSubscribers(
  subs: ActiveSubInput[],
  paidSubIds: Set<string>,
  excludedUsers: Set<string>,
  expertOwner: Record<string, string | null | undefined>,
  nowMs: number,
): Record<string, ActiveSubscriberSummary> {
  const acc: Record<string, { paid: Map<string, boolean>; unpaid: Set<string> }> = {};
  for (const s of subs) {
    const eid = s.expert_id;
    if (!eid || !isActiveSub(s, nowMs)) continue;
    if (excludedUsers.has(s.user_id) || expertOwner[eid] === s.user_id) continue;
    const a = (acc[eid] ||= { paid: new Map(), unpaid: new Set() });
    if (paidSubIds.has(s.id)) {
      const yearly = /year|annual/i.test(s.billing_cycle || '');
      a.paid.set(s.user_id, (a.paid.get(s.user_id) ?? false) || yearly);
    } else a.unpaid.add(s.user_id);
  }
  const out: Record<string, ActiveSubscriberSummary> = {};
  for (const [eid, a] of Object.entries(acc)) {
    const paidUsers = [...a.paid.keys()];
    const yearly = [...a.paid.values()].filter(Boolean).length;
    out[eid] = {
      paidUsers,
      unpaidUsers: [...a.unpaid].filter((u) => !a.paid.has(u)),
      yearly,
      monthly: paidUsers.length - yearly,
    };
  }
  return out;
}
