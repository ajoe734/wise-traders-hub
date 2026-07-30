/**
 * Legacy 路徑收斂（A5 / A6）。
 *
 * A5：`/me/*` 舊路徑重導時必須保留子路徑、query 與 hash，
 *     不可一律丟到 `/app/account`（會讓通知深連結失去目標）。
 * A6：通知連結一律存相對路徑；若歷史資料存了同站絕對網址，
 *     在開啟前轉回相對路徑交給 react-router，避免整頁重載或 404。
 */

/** 本站主機（含 preview / 自訂網域）。 */
const INTERNAL_HOSTS = [
  'legendflow.tw',
  'www.legendflow.tw',
  'wise-traders-hub.lovable.app',
  'localhost',
  '127.0.0.1',
];

const isInternalHost = (host: string): boolean => {
  const h = host.toLowerCase();
  if (INTERNAL_HOSTS.includes(h)) return true;
  if (h.endsWith('.lovableproject.com')) return true;
  if (h.startsWith('id-preview--') && h.endsWith('.lovable.app')) return true;
  if (typeof window !== 'undefined' && h === window.location.hostname.toLowerCase()) return true;
  return false;
};

/** `/me/<seg>` → 目標路徑（靜態對映）。 */
const ME_STATIC: Record<string, string> = {
  '': '/app/account',
  account: '/app/account',
  signals: '/app/signals',
  journals: '/app/journals',
  subscriptions: '/app/subscriptions',
  explore: '/app/explore',
  holdings: '/app',
  notifications: '/account/notifications',
  profile: '/account/profile',
  remittance: '/account/remittance',
};

/** `/me/<seg>/<rest>` → `/app/<seg>/<rest>`（保留尾段）。 */
const ME_DYNAMIC = new Set(['signal', 'journal', 'expert', 'checkout']);

/** 其他 legacy 路徑的靜態對映。 */
const LEGACY_STATIC: Record<string, string> = {
  '/account/subscriptions': '/app/account',
  '/free-checkup': '/holding-checkup',
  '/explore': '/experts',
};

const stripTrailingSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/**
 * 把 legacy pathname 轉成正式 pathname，並接回 search / hash。
 * 非 legacy 路徑原樣回傳（僅正規化尾斜線）。
 */
export function resolveLegacyPath(pathname: string, search = '', hash = ''): string {
  const raw = stripTrailingSlash(pathname || '/');
  const lower = raw.toLowerCase();
  const suffix = `${search || ''}${hash || ''}`;

  if (LEGACY_STATIC[lower]) return `${LEGACY_STATIC[lower]}${suffix}`;

  if (lower === '/me' || lower.startsWith('/me/')) {
    const segs = raw.split('/').filter(Boolean).slice(1); // 去掉 'me'
    const head = (segs[0] || '').toLowerCase();
    const rest = segs.slice(1);

    if (ME_DYNAMIC.has(head) && rest.length > 0) {
      return `/app/${head}/${rest.join('/')}${suffix}`;
    }
    const mapped = ME_STATIC[head];
    return `${mapped ?? '/app/account'}${suffix}`;
  }

  return `${raw}${suffix}`;
}

/**
 * 通知連結正規化：
 *  - 空值 → null
 *  - 同站絕對網址（非 Storage signed URL）→ 轉為相對路徑並套 legacy 對映
 *  - Storage signed URL / 其他外部網址 → 原樣（由 openNotificationLink 走外部開啟）
 *  - 相對路徑 → 補前導斜線 + legacy 對映
 */
export function normalizeNotificationPath(link: string | null | undefined): string | null {
  if (!link) return null;
  const trimmed = link.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return trimmed;
    }
    if (/\/storage\/v[0-9]+\/object\//i.test(url.pathname)) return trimmed;
    if (!isInternalHost(url.hostname)) return trimmed;
    return resolveLegacyPath(url.pathname, url.search, url.hash);
  }

  if (trimmed.startsWith('#') || trimmed.startsWith('?')) return trimmed;

  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const [pathAndSearch, ...hashParts] = withSlash.split('#');
  const [path, ...searchParts] = pathAndSearch.split('?');
  const search = searchParts.length ? `?${searchParts.join('?')}` : '';
  const hash = hashParts.length ? `#${hashParts.join('#')}` : '';
  return resolveLegacyPath(path, search, hash);
}
