/**
 * GA4 官方 gtag.js（直接送到 G-LGJNXMX3DM，不經 GTM 容器）。
 *
 * - gtag.js 由 index.html 載入，config 設 send_page_view:false，
 *   page_view 一律由 Ga4PageViewTracker 在路由變化時送出（含首頁載入）。
 * - 後台路徑（/company、/admin、/e2e）以 `ga-disable-<ID>` 全面停用，
 *   連 GA4 加強型評估（捲動、點擊）也不會送。
 * - 事件參數只允許白名單欄位，絕不帶姓名、email、電話。
 */
export const GA4_MEASUREMENT_ID = 'G-LGJNXMX3DM';

const BLOCKED_PREFIXES = ['/company', '/admin', '/e2e'];

export function isGa4BlockedPath(pathname: string): boolean {
  return BLOCKED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const PII_KEY = /(^|_)(name|email|mail|phone|tel|mobile|address)$/i;
const EMAIL_VALUE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const ALLOWED_NAME_KEYS = new Set(['item_name']);

/** 移除可能是個資的欄位與值（item_name 為商品名稱，保留）。 */
export function stripPii<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripPii(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      if (PII_KEY.test(k) && !ALLOWED_NAME_KEYS.has(k)) continue;
      if (typeof v === 'string' && EMAIL_VALUE.test(v)) continue;
      out[k] = stripPii(v);
    }
    return out as T;
  }
  return value;
}

type GtagFn = (...args: unknown[]) => void;

function currentPath(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname;
}

function isBot(): boolean {
  try { return typeof navigator !== 'undefined' && navigator.webdriver === true; } catch { return false; }
}

/** 依目前路徑切換 GA4 停用旗標（後台頁全面不送）。 */
export function syncGa4Disabled(pathname: string = currentPath()): boolean {
  const disabled = isGa4BlockedPath(pathname) || isBot();
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>)[`ga-disable-${GA4_MEASUREMENT_ID}`] = disabled;
  }
  return disabled;
}

function gtag(): GtagFn | null {
  if (typeof window === 'undefined') return null;
  const g = (window as unknown as { gtag?: GtagFn }).gtag;
  return typeof g === 'function' ? g : null;
}

export function ga4Event(name: string, params: Record<string, unknown> = {}): void {
  try {
    if (syncGa4Disabled()) return;
    const g = gtag();
    if (!g) return;
    g('event', name, { ...stripPii(params), send_to: GA4_MEASUREMENT_ID });
  } catch {
    // analytics 不可影響主流程
  }
}

export function ga4PageView(pathname: string, search = ''): void {
  if (syncGa4Disabled(pathname)) return;
  // 移除 query 中可能的個資參數（如 email=），保留 utm_*
  const params = new URLSearchParams(search);
  for (const k of [...params.keys()]) if (PII_KEY.test(k) || EMAIL_VALUE.test(params.get(k) ?? '')) params.delete(k);
  const qs = params.toString();
  const location = typeof window !== 'undefined' ? `${window.location.origin}${pathname}${qs ? `?${qs}` : ''}` : pathname;
  ga4Event('page_view', {
    page_path: `${pathname}${qs ? `?${qs}` : ''}`,
    page_location: location,
    page_title: typeof document !== 'undefined' ? document.title : undefined,
  });
}
