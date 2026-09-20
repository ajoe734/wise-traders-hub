/**
 * 疑似同一人的多重帳號偵測（純函式）。
 *
 * 事故背景：會員以 Email 帳號付費訂閱，卻用 LINE 登入的另一個身分開週記頁，
 * 於是看到「尚未訂閱任何實戰導師」。Email 與 LINE 是刻意隔離的兩個身分，
 * 系統沒有壞，但客服在後台看不出「這人有兩個帳號」，只能靠人工比對。
 *
 * 本模組只做判定，不做任何寫入；合併一律由管理員手動按下「代客綁定」。
 */

export interface AccountRow {
  user_id: string;
  email: string;
  display_name: string | null;
  is_line: boolean;
  line_user_id?: string | null;
  last_sign_in_at?: string | null;
}

export type DuplicateReason = 'line_user_id' | 'display_name' | 'email_local';

export interface DuplicateMember extends AccountRow {
  has_subscription: boolean;
}

export interface DuplicateCluster {
  key: string;
  reasons: DuplicateReason[];
  members: DuplicateMember[];
}

export const REASON_LABEL: Record<DuplicateReason, string> = {
  line_user_id: '綁定同一個 LINE 帳號',
  display_name: '顯示名稱相同',
  email_local: 'Email 帳號名稱相同',
};

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/g;

/** 取顯示名稱的比對核心：優先中文姓名，否則用去雜訊的小寫英數。 */
export function normalizeDisplayName(raw: string | null | undefined): string {
  if (!raw) return '';
  const cjk = (raw.match(CJK_RE) || []).join('');
  if (cjk.length >= 2) return cjk;
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** LINE 虛擬信箱不具識別意義，不能拿來當「同一人」的訊號。 */
export function isVirtualLineEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith('@line.local');
}

/** Email 本地部分（去掉 +tag），虛擬信箱回空字串。 */
export function emailLocalPart(email: string | null | undefined): string {
  if (!email || isVirtualLineEmail(email)) return '';
  const local = email.toLowerCase().split('@')[0] || '';
  return local.split('+')[0].trim();
}

const IS_CJK_ONLY = /^[\u3400-\u9fff\uf900-\ufaff]+$/;

function nameMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // 互相包含只對中文姓名開放（「Charlene 邱郁惠 🎀」正規化後已是「邱郁惠」，
  // 這裡處理的是「邱郁惠」vs「邱郁惠惠」這種尾綴）。英文名一律要求完全相同，
  // 否則 Huang ⊂ Chuang 這種會誤判成同一人（正式資料實際踩到過）。
  if (!IS_CJK_ONLY.test(a) || !IS_CJK_ONLY.test(b)) return false;
  if (a.length >= 3 && b.length >= 3) {
    return a.includes(b) || b.includes(a);
  }
  return false;
}

/**
 * 找出「疑似同一人、但只有部分帳號有訂閱」的群集。
 * 兩邊都有訂閱或兩邊都沒訂閱都不回傳 —— 那不會造成看不到內容的客訴。
 */
export function findDuplicateIdentityClusters(
  accounts: AccountRow[],
  subscribedUserIds: Iterable<string>,
): DuplicateCluster[] {
  const subscribed = new Set(subscribedUserIds);
  const list = accounts.filter((a) => !!a.user_id);

  const parent = new Map<string, string>();
  const reasons = new Map<string, Set<DuplicateReason>>();
  list.forEach((a) => parent.set(a.user_id, a.user_id));

  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let cur = x;
    while (parent.get(cur) !== cur) {
      const next = parent.get(cur)!;
      parent.set(cur, r);
      cur = next;
    }
    return r;
  };
  const union = (a: string, b: string, reason: DuplicateReason) => {
    const ra = find(a);
    const rb = find(b);
    const merged = new Set<DuplicateReason>([
      ...(reasons.get(ra) ?? []),
      ...(reasons.get(rb) ?? []),
      reason,
    ]);
    if (ra !== rb) parent.set(rb, ra);
    reasons.set(find(a), merged);
  };

  // 訊號 1：同一個 LINE user id（最強）
  const byLine = new Map<string, string[]>();
  list.forEach((a) => {
    const lid = (a.line_user_id || '').trim();
    if (!lid) return;
    byLine.set(lid, [...(byLine.get(lid) ?? []), a.user_id]);
  });
  byLine.forEach((ids) => {
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i], 'line_user_id');
  });

  // 訊號 2：Email 本地部分相同
  const byLocal = new Map<string, string[]>();
  list.forEach((a) => {
    const local = emailLocalPart(a.email);
    if (local.length < 3) return;
    byLocal.set(local, [...(byLocal.get(local) ?? []), a.user_id]);
  });
  byLocal.forEach((ids) => {
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i], 'email_local');
  });

  // 訊號 3：顯示名稱正規化後相同或互相包含
  const named = list
    .map((a) => ({ id: a.user_id, n: normalizeDisplayName(a.display_name) }))
    .filter((x) => x.n.length >= 2);
  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      if (nameMatches(named[i].n, named[j].n)) union(named[i].id, named[j].id, 'display_name');
    }
  }

  const byRoot = new Map<string, AccountRow[]>();
  list.forEach((a) => {
    const r = find(a.user_id);
    byRoot.set(r, [...(byRoot.get(r) ?? []), a]);
  });

  const clusters: DuplicateCluster[] = [];
  byRoot.forEach((members, root) => {
    if (members.length < 2) return;
    const withFlag: DuplicateMember[] = members.map((m) => ({
      ...m,
      has_subscription: subscribed.has(m.user_id),
    }));
    const someSubscribed = withFlag.some((m) => m.has_subscription);
    const someNot = withFlag.some((m) => !m.has_subscription);
    if (!someSubscribed || !someNot) return;
    clusters.push({
      key: root,
      reasons: Array.from(reasons.get(root) ?? []).sort(),
      members: withFlag.sort((a, b) => Number(b.has_subscription) - Number(a.has_subscription)),
    });
  });

  return clusters.sort((a, b) => a.key.localeCompare(b.key));
}

/** user_id → 該帳號所屬群集，供表格逐列查詢。 */
export function indexClustersByUser(clusters: DuplicateCluster[]): Record<string, DuplicateCluster> {
  const map: Record<string, DuplicateCluster> = {};
  clusters.forEach((c) => c.members.forEach((m) => { map[m.user_id] = c; }));
  return map;
}
