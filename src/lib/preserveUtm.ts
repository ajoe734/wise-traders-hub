/**
 * UTM 保留（純函式，無副作用）。
 *
 * IG bio → /s/:slug → /expert/:slug → /checkout/:slug/:planId 的整條漏斗中，
 * 只保留白名單內的 utm_* 參數，其餘 query 一律丟棄，避免把私有參數（preview、
 * from、token…）帶進下一頁。
 *
 * first-touch 落地仍由既有 `trafficTracker` 負責，本檔不碰。
 */

export const UTM_WHITELIST = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;

export type UtmKey = (typeof UTM_WHITELIST)[number];

/** 從一段 query string（可含或不含前導 `?`）萃取白名單 utm。 */
export function extractUtm(search?: string | null): Partial<Record<UtmKey, string>> {
  const out: Partial<Record<UtmKey, string>> = {};
  if (!search) return out;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  for (const key of UTM_WHITELIST) {
    const v = params.get(key);
    if (v != null && v !== '') out[key] = v;
  }
  return out;
}

/** 白名單 utm 序列化成 query string（不含前導 `?`）；無值回空字串。 */
export function utmQueryString(search?: string | null): string {
  const utm = extractUtm(search);
  const params = new URLSearchParams();
  for (const key of UTM_WHITELIST) {
    const v = utm[key];
    if (v) params.set(key, v);
  }
  return params.toString();
}

/**
 * 把來源 query 中的白名單 utm 接到目標路徑上。
 * - 目標已有同名參數時，以目標為準（不覆寫）。
 * - 目標的 hash（`#plans`）保留在最後。
 */
export function preserveUtm(to: string, search?: string | null): string {
  const utm = extractUtm(search);
  const keys = Object.keys(utm) as UtmKey[];
  if (keys.length === 0) return to;

  const hashIdx = to.indexOf('#');
  const hash = hashIdx >= 0 ? to.slice(hashIdx) : '';
  const withoutHash = hashIdx >= 0 ? to.slice(0, hashIdx) : to;

  const qIdx = withoutHash.indexOf('?');
  const path = qIdx >= 0 ? withoutHash.slice(0, qIdx) : withoutHash;
  const params = new URLSearchParams(qIdx >= 0 ? withoutHash.slice(qIdx + 1) : '');

  for (const key of keys) {
    if (!params.has(key)) params.set(key, utm[key] as string);
  }

  const qs = params.toString();
  return `${path}${qs ? `?${qs}` : ''}${hash}`;
}

/** 取 utm_campaign（analytics props 用）。 */
export function utmCampaignOf(search?: string | null): string | undefined {
  return extractUtm(search).utm_campaign;
}
