// Pure GA4 Data API helpers shared by the `ga4-report` Edge Function and Vitest.
// No Deno / browser globals except WebCrypto + fetch (injected), so the
// browser bundle never imports this file.

export const GA4_SECRET_PROPERTY = 'GA4_PROPERTY_ID';
export const GA4_SECRET_SERVICE_ACCOUNT = 'GA4_SERVICE_ACCOUNT_JSON';
export const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
export const GA4_TOP_PAGES = 15;
export const GA4_MAX_RANGE_DAYS = 400;

export type Ga4Status =
  | 'OK'
  | 'NO_DATA'
  | 'NOT_CONFIGURED'
  | 'INVALID_CONFIG'
  | 'INVALID_INPUT'
  | 'AUTH_FAILED'
  | 'PERMISSION_DENIED'
  | 'API_DISABLED'
  | 'PROPERTY_NOT_FOUND'
  | 'QUERY_ERROR';

export interface Ga4ServiceAccount { client_email: string; private_key: string; token_uri?: string }

export interface Ga4Config { propertyId: string; account: Ga4ServiceAccount; serviceAccountEmail: string }

export type ConfigResult =
  | { ok: true; config: Ga4Config }
  | { ok: false; status: 'NOT_CONFIGURED' | 'INVALID_CONFIG'; missing: string[]; message: string; serviceAccountEmail: string | null };

/** Property ID must be digits only. GA account IDs and G- measurement IDs are rejected upstream by GA, but we reject G- early. */
export function readGa4Config(env: (name: string) => string | undefined): ConfigResult {
  const rawProp = (env(GA4_SECRET_PROPERTY) ?? '').trim();
  const rawSa = (env(GA4_SECRET_SERVICE_ACCOUNT) ?? '').trim();
  const missing = [
    ...(rawProp ? [] : [GA4_SECRET_PROPERTY]),
    ...(rawSa ? [] : [GA4_SECRET_SERVICE_ACCOUNT]),
  ];
  let account: Ga4ServiceAccount | null = null;
  let saError: string | null = null;
  if (rawSa) {
    try {
      const j = JSON.parse(rawSa);
      if (typeof j?.client_email === 'string' && typeof j?.private_key === 'string' && j.private_key.includes('PRIVATE KEY')) {
        account = { client_email: j.client_email, private_key: j.private_key, token_uri: j.token_uri };
      } else saError = '服務帳戶 JSON 缺少 client_email 或 private_key';
    } catch { saError = '服務帳戶 JSON 格式錯誤'; }
  }
  const email = account?.client_email ?? null;
  if (missing.length) return { ok: false, status: 'NOT_CONFIGURED', missing, message: `尚未設定：${missing.join('、')}`, serviceAccountEmail: email };
  if (saError) return { ok: false, status: 'INVALID_CONFIG', missing: [], message: saError, serviceAccountEmail: null };
  if (!/^\d{6,12}$/.test(rawProp)) {
    return { ok: false, status: 'INVALID_CONFIG', missing: [], message: 'GA4_PROPERTY_ID 必須是純數字的資源 ID（不是 G- 評估 ID，也不是帳戶 ID）', serviceAccountEmail: email };
  }
  return { ok: true, config: { propertyId: rawProp, account: account!, serviceAccountEmail: email! } };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export function validateRange(startDate: unknown, endDate: unknown): { ok: true; startDate: string; endDate: string } | { ok: false; message: string } {
  if (typeof startDate !== 'string' || typeof endDate !== 'string' || !DAY.test(startDate) || !DAY.test(endDate)) {
    return { ok: false, message: 'startDate / endDate 必須是 YYYY-MM-DD' };
  }
  const s = Date.parse(`${startDate}T00:00:00Z`), e = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || new Date(s).toISOString().slice(0, 10) !== startDate || new Date(e).toISOString().slice(0, 10) !== endDate) {
    return { ok: false, message: '日期不存在' };
  }
  if (e < s) return { ok: false, message: 'endDate 早於 startDate' };
  if ((e - s) / 86400000 + 1 > GA4_MAX_RANGE_DAYS) return { ok: false, message: `期間不可超過 ${GA4_MAX_RANGE_DAYS} 天` };
  return { ok: true, startDate, endDate };
}

/** One batchRunReports body: [0] daily trend, [1] top pages. Totals come from metricAggregations TOTAL (period-deduplicated users). */
export function buildBatchRequest(startDate: string, endDate: string) {
  const dateRanges = [{ startDate, endDate }];
  const metrics = [{ name: 'totalUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }];
  return {
    requests: [
      { dateRanges, dimensions: [{ name: 'date' }], metrics, metricAggregations: ['TOTAL'], orderBys: [{ dimension: { dimensionName: 'date' } }], keepEmptyRows: true, limit: 500 },
      { dateRanges, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }, { name: 'totalUsers' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: GA4_TOP_PAGES },
    ],
  };
}

export interface Ga4DailyRow { day: string; users: number; sessions: number; pageViews: number }
export interface Ga4PageRow { path: string; pageViews: number; users: number }
export interface Ga4Report {
  propertyId: string; timeZone: string | null; startDate: string; endDate: string;
  totals: { users: number; sessions: number; pageViews: number };
  daily: Ga4DailyRow[]; topPages: Ga4PageRow[];
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const ymd = (s: string) => /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;

/** Every day in [start,end] gets a row; GA omits days only if keepEmptyRows fails, so fill zeros explicitly. */
export function parseBatchResponse(body: any, propertyId: string, startDate: string, endDate: string): { status: 'OK' | 'NO_DATA'; report: Ga4Report } {
  const [trend, pages] = Array.isArray(body?.reports) ? body.reports : [];
  const byDay = new Map<string, Ga4DailyRow>();
  for (const r of trend?.rows ?? []) {
    const day = ymd(String(r?.dimensionValues?.[0]?.value ?? ''));
    const m = r?.metricValues ?? [];
    byDay.set(day, { day, users: num(m[0]?.value), sessions: num(m[1]?.value), pageViews: num(m[2]?.value) });
  }
  const daily: Ga4DailyRow[] = [];
  for (let t = Date.parse(`${startDate}T00:00:00Z`), e = Date.parse(`${endDate}T00:00:00Z`); t <= e; t += 86400000) {
    const day = new Date(t).toISOString().slice(0, 10);
    daily.push(byDay.get(day) ?? { day, users: 0, sessions: 0, pageViews: 0 });
  }
  const tot = trend?.totals?.[0]?.metricValues ?? [];
  const totals = tot.length
    ? { users: num(tot[0]?.value), sessions: num(tot[1]?.value), pageViews: num(tot[2]?.value) }
    : { users: 0, sessions: daily.reduce((a, d) => a + d.sessions, 0), pageViews: daily.reduce((a, d) => a + d.pageViews, 0) };
  const topPages = (pages?.rows ?? []).map((r: any) => ({
    path: String(r?.dimensionValues?.[0]?.value ?? ''),
    pageViews: num(r?.metricValues?.[0]?.value),
    users: num(r?.metricValues?.[1]?.value),
  }));
  const timeZone = trend?.metadata?.timeZone ?? pages?.metadata?.timeZone ?? null;
  const empty = totals.users === 0 && totals.sessions === 0 && totals.pageViews === 0 && topPages.length === 0;
  return { status: empty ? 'NO_DATA' : 'OK', report: { propertyId, timeZone, startDate, endDate, totals, daily, topPages } };
}

/** Map a Google API error response to a user-visible status. */
export function classifyGoogleError(httpStatus: number, body: any): { status: Ga4Status; message: string } {
  const err = body?.error ?? {};
  const msg = String(err.message ?? body?.error_description ?? '');
  const reasons: string[] = (err.details ?? []).map((d: any) => String(d?.reason ?? '')).filter(Boolean);
  if (reasons.includes('SERVICE_DISABLED') || /has not been used|is disabled/i.test(msg)) {
    return { status: 'API_DISABLED', message: 'Google Analytics Data API 尚未在服務帳戶所屬的 Google Cloud 專案啟用' };
  }
  if (httpStatus === 401 || body?.error === 'invalid_grant' || body?.error === 'invalid_client') {
    return { status: 'AUTH_FAILED', message: `服務帳戶驗證失敗：${msg || body?.error || httpStatus}` };
  }
  if (httpStatus === 403) return { status: 'PERMISSION_DENIED', message: '服務帳戶沒有此 GA4 資源的讀取權限（需在 GA4 資源存取管理加入「檢視者」）' };
  if (httpStatus === 404) return { status: 'PROPERTY_NOT_FOUND', message: '找不到此 GA4 資源 ID' };
  if (httpStatus === 400 && /property/i.test(msg)) return { status: 'PROPERTY_NOT_FOUND', message: `GA4 資源 ID 無效：${msg}` };
  return { status: 'QUERY_ERROR', message: `GA4 查詢失敗（HTTP ${httpStatus}）：${msg || '未知錯誤'}` };
}

// ---------- service-account JWT (RS256) ----------
const b64url = (bytes: Uint8Array) => {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

export async function signServiceAccountJwt(account: Ga4ServiceAccount, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const pem = account.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const head = enc({ alg: 'RS256', typ: 'JWT' });
  const claim = enc({ iss: account.client_email, scope: GA4_SCOPE, aud: account.token_uri || 'https://oauth2.googleapis.com/token', iat: nowSec, exp: nowSec + 3600 });
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`)));
  return `${head}.${claim}.${b64url(sig)}`;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type Ga4Result =
  | { status: 'OK' | 'NO_DATA'; report: Ga4Report; serviceAccountEmail: string }
  | { status: Exclude<Ga4Status, 'OK' | 'NO_DATA'>; message: string; missing?: string[]; serviceAccountEmail: string | null };

/** Full flow: config → token → batchRunReports → parse. Never returns the token or key. */
export async function runGa4Report(env: (n: string) => string | undefined, input: { startDate: unknown; endDate: unknown }, fetchImpl: FetchLike): Promise<Ga4Result> {
  const range = validateRange(input.startDate, input.endDate);
  if (!range.ok) return { status: 'INVALID_INPUT', message: range.message, serviceAccountEmail: null };
  const cfg = readGa4Config(env);
  if (!cfg.ok) return { status: cfg.status, message: cfg.message, missing: cfg.missing, serviceAccountEmail: cfg.serviceAccountEmail };
  const { config } = cfg;
  let token: string;
  try {
    const assertion = await signServiceAccountJwt(config.account);
    const tr = await fetchImpl(config.account.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    const tj = await tr.json().catch(() => ({}));
    if (!tr.ok || !tj?.access_token) {
      const c = classifyGoogleError(tr.status === 400 ? 401 : tr.status, tj);
      return { status: c.status === 'QUERY_ERROR' ? 'AUTH_FAILED' : c.status, message: c.message, serviceAccountEmail: config.serviceAccountEmail } as Ga4Result;
    }
    token = tj.access_token;
  } catch (e) {
    return { status: 'INVALID_CONFIG', message: `私鑰無法使用：${(e as Error).message}`, serviceAccountEmail: config.serviceAccountEmail };
  }
  const res = await fetchImpl(`https://analyticsdata.googleapis.com/v1beta/properties/${config.propertyId}:batchRunReports`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildBatchRequest(range.startDate, range.endDate)),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const c = classifyGoogleError(res.status, body);
    return { status: c.status as Exclude<Ga4Status, 'OK' | 'NO_DATA'>, message: c.message, serviceAccountEmail: config.serviceAccountEmail };
  }
  const parsed = parseBatchResponse(body, config.propertyId, range.startDate, range.endDate);
  return { status: parsed.status, report: parsed.report, serviceAccountEmail: config.serviceAccountEmail };
}
