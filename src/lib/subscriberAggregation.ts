/**
 * 訂閱者聚合與續訂率（純函式，無 IO）。
 *
 * 口徑（單一資料源，UI 與測試共用）：
 * - 一個「期間（spell）」= member_subscriptions / checkup_subscriptions 的一列。
 * - 一個「群組（group）」= 同一使用者 × 同一老師（健檢視為單一產品線）的所有期間。
 * - 續訂率 = 已到期且未取消的期間中，同一群組於到期後 windowDays 天內有新開通者的比例。
 *   仍在有效期內的期間不計入分母（還沒輪到續訂，不算流失）。
 */

export type SubKind = 'expert' | 'checkup';

export interface SpellRow {
  id: string;
  user_id: string;
  kind: SubKind;
  plan_name: string;
  expert_name?: string | null;
  status: string;
  started_at: string;
  expires_at: string | null;
}

export type GroupStatus = 'live' | 'expiring' | 'churned' | 'canceled';

export interface SubscriberGroup {
  key: string;
  user_id: string;
  kind: SubKind;
  expert_name: string | null;
  spells: SpellRow[];        // 新到舊
  latest: SpellRow;
  cycles: number;
  first_started_at: string;
  expires_at: string | null;
  remaining_days: number | null;
  status: GroupStatus;
}

export const EXPIRING_SOON_DAYS = 7;
export const RENEWAL_WINDOW_DAYS = 30;

const DAY = 24 * 60 * 60 * 1000;
const ts = (v: string | null | undefined) => (v ? new Date(v).getTime() : NaN);

export function groupKey(r: SpellRow): string {
  return r.kind === 'expert' ? `expert|${r.user_id}|${r.expert_name || '未指派'}` : `checkup|${r.user_id}`;
}

export function remainingDays(expiresAt: string | null, nowMs: number): number | null {
  if (!expiresAt) return null;
  return Math.ceil((ts(expiresAt) - nowMs) / DAY);
}

export function isLiveSpell(r: SpellRow, nowMs: number): boolean {
  return r.status === 'active' && (!r.expires_at || ts(r.expires_at) > nowMs);
}

/** 已結束（到期或視為到期）且非取消 → 可納入續訂率分母。 */
export function isEndedSpell(r: SpellRow, nowMs: number): boolean {
  if (r.status === 'canceled') return false;
  if (isLiveSpell(r, nowMs)) return false;
  return !!r.expires_at && ts(r.expires_at) <= nowMs;
}

export function groupSubscriberSpells(rows: SpellRow[], nowMs: number = Date.now()): SubscriberGroup[] {
  const map = new Map<string, SpellRow[]>();
  for (const r of rows) {
    const k = groupKey(r);
    const arr = map.get(k);
    if (arr) arr.push(r); else map.set(k, [r]);
  }
  const groups: SubscriberGroup[] = [];
  for (const [key, spells] of map) {
    spells.sort((a, b) => ts(b.started_at) - ts(a.started_at));
    const latest = spells[0];
    const first = spells[spells.length - 1];
    const rd = remainingDays(latest.expires_at, nowMs);
    let status: GroupStatus;
    if (isLiveSpell(latest, nowMs)) {
      status = rd != null && rd <= EXPIRING_SOON_DAYS ? 'expiring' : 'live';
    } else if (latest.status === 'canceled') {
      status = 'canceled';
    } else {
      status = 'churned';
    }
    groups.push({
      key,
      user_id: latest.user_id,
      kind: latest.kind,
      expert_name: latest.kind === 'expert' ? (latest.expert_name || null) : null,
      spells,
      latest,
      cycles: spells.length,
      first_started_at: first.started_at,
      expires_at: latest.expires_at,
      remaining_days: rd,
      status,
    });
  }
  return groups.sort((a, b) => ts(b.latest.started_at) - ts(a.latest.started_at));
}

export interface RenewalRate {
  denominator: number;
  numerator: number;
  rate: number; // 0-100，四捨五入
}

/** 續訂率：已結束的期間中，同群組在 windowDays 內有新開通者。 */
export function calcRenewalRate(
  rows: SpellRow[],
  nowMs: number = Date.now(),
  windowDays: number = RENEWAL_WINDOW_DAYS,
): RenewalRate {
  const byKey = new Map<string, SpellRow[]>();
  for (const r of rows) {
    const k = groupKey(r);
    const arr = byKey.get(k);
    if (arr) arr.push(r); else byKey.set(k, [r]);
  }
  let denominator = 0;
  let numerator = 0;
  for (const [, spells] of byKey) {
    for (const r of spells) {
      if (!isEndedSpell(r, nowMs)) continue;
      denominator++;
      const deadline = ts(r.expires_at) + windowDays * DAY;
      const renewed = spells.some(
        (o) => o.id !== r.id && ts(o.started_at) > ts(r.started_at) && ts(o.started_at) <= deadline,
      );
      if (renewed) numerator++;
    }
  }
  return {
    denominator,
    numerator,
    rate: denominator > 0 ? Math.round((numerator / denominator) * 100) : 0,
  };
}

/** 現存有效比例（原本被誤稱為續訂率的數字）。 */
export function calcActiveShare(rows: SpellRow[], nowMs: number = Date.now()): RenewalRate {
  const denominator = rows.filter((r) => r.status !== 'canceled').length;
  const numerator = rows.filter((r) => isLiveSpell(r, nowMs)).length;
  return { denominator, numerator, rate: denominator > 0 ? Math.round((numerator / denominator) * 100) : 0 };
}

/** 搜尋前綴解析：`email:abc 老師:彥愷 剩下的自由字串` */
export interface ParsedSearch {
  free: string;
  fields: Partial<Record<'email' | 'expert' | 'status' | 'plan' | 'line', string>>;
}

const PREFIX_MAP: Record<string, keyof ParsedSearch['fields']> = {
  email: 'email',
  mail: 'email',
  '老師': 'expert',
  expert: 'expert',
  '狀態': 'status',
  status: 'status',
  '方案': 'plan',
  plan: 'plan',
  line: 'line',
};

export function parseSearch(q: string): ParsedSearch {
  const fields: ParsedSearch['fields'] = {};
  const freeParts: string[] = [];
  for (const token of q.trim().split(/\s+/).filter(Boolean)) {
    const m = token.match(/^([^:：]+)[:：](.+)$/);
    const key = m ? PREFIX_MAP[m[1].toLowerCase()] : undefined;
    if (m && key) fields[key] = m[2].toLowerCase();
    else freeParts.push(token.toLowerCase());
  }
  return { free: freeParts.join(' '), fields };
}
