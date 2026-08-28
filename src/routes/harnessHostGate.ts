/**
 * harnessHostGate — `/e2e/*` harness 路由的**唯一** runtime 可達性判定。
 *
 * 為什麼從 build-time gate 改成 runtime gate：
 * 原本 `harnessRoutes.tsx` 用 `import.meta.env.DEV` 這個 build-time literal，
 * `vite build` 會把整段剝除。Lovable 的 **unpublished Hosted Preview** 用的是
 * production-like build，所以 `preview--<project>.lovable.app/e2e/...` 一律 404，
 * 導致 Hosted 端根本無法人工驗收 harness seam。
 *
 * 安全邊界不變的理由：
 *   - 允許集合是**封閉列舉**：本機 dev/localhost，或 hostname 嚴格等於
 *     `preview--<slug>.lovable.app`（unpublished preview，僅 Lovable 帳號可達）。
 *   - 自訂網域（legendflow.tw / www.legendflow.tw）、已發布 production
 *     （wise-traders-hub.lovable.app）、以及任何 lookalike
 *     （`preview--x.lovable.app.evil.com`、`xpreview--a.lovable.app`）一律 false → 404。
 *   - query string（含 `?stage2=1`）**不參與授權**；harness 只吃 fake gateway /
 *     fake fixture，preview route 不讀任何真實使用者資料。
 *
 * 這支必須維持純函式（吃 hostname 字串），才能被 executable contract 直接驗。
 */

/** unpublished Hosted Preview：`preview--<slug>.lovable.app`，完全錨定。 */
export const PREVIEW_HOST_RE = /^preview--[a-z0-9-]+\.lovable\.app$/;

/** 本機開發主機（含 IPv6 loopback 的方括號形式）。 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);

export function isLocalHost(hostname: string): boolean {
  const h = String(hostname || '').toLowerCase();
  return LOCAL_HOSTS.has(h) || h.endsWith('.localhost');
}

export function isPreviewHost(hostname: string): boolean {
  return PREVIEW_HOST_RE.test(String(hostname || '').toLowerCase());
}

/** 純函式判定：localhost 或合法 preview host 才允許 harness。 */
export function isHarnessHostAllowed(hostname: string | null | undefined): boolean {
  if (!hostname) return false;
  return isLocalHost(hostname) || isPreviewHost(hostname);
}

/**
 * Runtime gate（route 掛載用）。
 * 刻意**不是** build-time literal，Rollup 因此不會 tree-shake 掉 preview-host 這條路徑。
 */
export function harnessRoutesEnabled(): boolean {
  let dev = false;
  try {
    dev = (import.meta as unknown as { env?: { DEV?: boolean } })?.env?.DEV === true;
  } catch {
    dev = false;
  }
  if (dev) return true;
  if (typeof window === 'undefined' || !window.location) return false;
  return isHarnessHostAllowed(window.location.hostname);
}
