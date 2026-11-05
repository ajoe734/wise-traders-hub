/**
 * 訂閱「新訂／續訂／回流」判定（純函式）。
 * 同一人、同一位老師名下：之前沒有任何訂閱 → new；
 * 本期起始日 ≤ 上一期到期日（以台北日期比）→ renew；否則 return，gapDays = 相隔天數。
 */
export interface KindSubInput {
  id: string;
  user_id: string;
  expertId: string | null;
  started_at: string | null;
  expires_at: string | null;
}
export type SubKind = { kind: 'new' } | { kind: 'renew' } | { kind: 'return'; gapDays: number };

const DAY = 86_400_000;
const taipeiDay = (iso: string) => Math.floor((new Date(iso).getTime() + 8 * 3_600_000) / DAY);

export function classifySubscriptions(subs: KindSubInput[]): Record<string, SubKind> {
  const groups: Record<string, KindSubInput[]> = {};
  for (const s of subs) {
    if (!s.expertId || !s.started_at) continue;
    (groups[`${s.user_id}|${s.expertId}`] ||= []).push(s);
  }
  const out: Record<string, SubKind> = {};
  for (const list of Object.values(groups)) {
    list.sort((a, b) => +new Date(a.started_at!) - +new Date(b.started_at!));
    let lastExpiry: number | null = null; // 台北日序
    let seen = false;
    for (const s of list) {
      const start = taipeiDay(s.started_at!);
      if (!seen) out[s.id] = { kind: 'new' };
      else if (lastExpiry == null || start <= lastExpiry) out[s.id] = { kind: 'renew' };
      else out[s.id] = { kind: 'return', gapDays: start - lastExpiry };
      seen = true;
      const exp = s.expires_at ? taipeiDay(s.expires_at) : null;
      lastExpiry = exp == null ? null : Math.max(lastExpiry ?? exp, exp);
    }
  }
  return out;
}

export function subKindLabel(k: SubKind | undefined): string {
  if (!k) return '—';
  if (k.kind === 'new') return '新訂';
  if (k.kind === 'renew') return '續訂';
  return `回流（隔 ${k.gapDays} 天）`;
}
