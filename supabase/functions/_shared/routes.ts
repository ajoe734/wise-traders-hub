/**
 * Edge Function 端的路徑常數層（對應前端 src/lib/routes.ts）。
 * 續訂／結帳連結一律指向公開的 /checkout/*，
 * 不可指向 /app/checkout/*（該路由有 subscriberOnly 守衛，已到期用戶會被擋住而無法續訂）。
 */

export type RenewalUrlOptions = {
  /** 站台前綴，例如 https://legendflow.tw。省略則回傳相對路徑。 */
  baseUrl?: string;
  /** 附加 query 參數（cycle、utm_* 等）。undefined / null / '' 會被略過。 */
  query?: Record<string, string | number | undefined | null>;
};

const joinBase = (baseUrl: string | undefined, path: string): string => {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
};

const withQuery = (path: string, query?: RenewalUrlOptions["query"]): string => {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
};

/** 專家方案續訂／結帳：/checkout/:slug/:planId */
export const renewalUrl = (
  expertSlug: string,
  planId: string,
  options: RenewalUrlOptions = {},
): string => {
  if (!expertSlug) throw new Error("renewalUrl: expertSlug is required");
  if (!planId) throw new Error("renewalUrl: planId is required");
  const path = `/checkout/${encodeURIComponent(expertSlug)}/${encodeURIComponent(planId)}`;
  return joinBase(options.baseUrl, withQuery(path, options.query));
};

/** 健檢方案續訂／結帳：/checkout/checkup/:planId */
export const checkupRenewalUrl = (
  planId: string,
  options: RenewalUrlOptions = {},
): string => {
  if (!planId) throw new Error("checkupRenewalUrl: planId is required");
  const path = `/checkout/checkup/${encodeURIComponent(planId)}`;
  return joinBase(options.baseUrl, withQuery(path, options.query));
};

/* ────────────────────────────────────────────────────────────────────────
 * 通知連結（notifications.link）單一資料源
 *
 * 事故背景：通知曾直接硬寫 `/admin/signals`、`/me/*`、或整段 signed URL，
 * 前台 react-router 找不到對應 route → 404。
 * 規則：
 *   1. notifications.link 一律是「站內相對路徑」，外部檔案下載走 download_url。
 *   2. 路徑只能由下列 builder 產生，禁止在各 function 內硬寫字串。
 *   3. /admin/* 一定要帶 expertSlug（route 是 /admin/:expertSlug/...）。
 * ──────────────────────────────────────────────────────────────────────── */

export type NotificationType = 'info' | 'warning' | 'error' | string;

export interface NotificationRowInput {
  userId: string;
  title: string;
  body: string;
  type?: NotificationType;
  /** 站內相對路徑，必須由本檔 builder 產生。 */
  link?: string | null;
  /** 外部檔案下載（signed URL）專用，不可放進 link。 */
  downloadUrl?: string | null;
}

/** 站內通知落點：一般會員通知中心。 */
export const accountNotificationsUrl = (): string => '/account/notifications';

/** 訂閱者的帳號頁。 */
export const accountUrl = (): string => '/app/account';

/** 訂閱者查看某位專家（含週記）。無 slug 時退回通知中心，不可產生 /app/expert/null。 */
export const expertDetailUrl = (slug?: string | null): string =>
  slug ? `/app/expert/${encodeURIComponent(slug)}` : accountNotificationsUrl();

/** 持倉健檢頁。 */
export const checkupUrl = (
  options: { jobId?: string | null; autorun?: boolean } = {},
): string => {
  const query: Record<string, string | undefined> = {};
  if (options.jobId) query.job = options.jobId;
  if (options.autorun) query.autorun = '1';
  return withQuery('/holding-checkup', query);
};

/** 分析師後台週記列表（route 為 /admin/:expertSlug/signals）。 */
export const adminSignalsUrl = (expertSlug?: string | null): string =>
  expertSlug ? `/admin/${encodeURIComponent(expertSlug)}/signals` : accountNotificationsUrl();

/** 分析師後台個人設定的初始資金區塊。 */
export const adminCapitalUrl = (expertSlug?: string | null): string =>
  expertSlug ? `/admin/${encodeURIComponent(expertSlug)}/profile#capital` : accountNotificationsUrl();

/** 公司後台頁（白名單，避免打錯字產生 404）。 */
export const COMPANY_PAGES = [
  'knowledge-base',
  'journals-export',
  'publish-batch-status',
  'line-push-history',
  'system-jobs',
  'audit-logs',
] as const;
export type CompanyPage = (typeof COMPANY_PAGES)[number];

export const companyUrl = (page: CompanyPage): string => {
  if (!COMPANY_PAGES.includes(page)) {
    throw new Error(`companyUrl: unknown company page "${page}"`);
  }
  return `/company/${page}`;
};

/** 已知會 404 的舊路徑樣式（缺 :expertSlug、legacy /me/*、絕對網址）。 */
const ADMIN_STATIC_404 = /^\/admin\/(signals|profile|plans|subscribers|performance|announcements|ai-studio)(\/|#|\?|$)/;

export type NotificationLinkProblem =
  | 'empty'
  | 'absolute_url'
  | 'not_relative'
  | 'legacy_me_path'
  | 'admin_missing_slug'
  | 'double_slash';

/** 回傳 null 代表合法；否則回傳問題碼。 */
export function validateNotificationLink(link: string | null | undefined): NotificationLinkProblem | null {
  if (!link || !link.trim()) return 'empty';
  const v = link.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return 'absolute_url';
  if (!v.startsWith('/')) return 'not_relative';
  if (v.startsWith('//')) return 'double_slash';
  if (v === '/me' || v.startsWith('/me/')) return 'legacy_me_path';
  if (ADMIN_STATIC_404.test(v)) return 'admin_missing_slug';
  return null;
}

/** 驗證並回傳 link，不合法直接丟錯（讓 CI / 測試在上線前擋下 404）。 */
export function assertNotificationLink(link: string): string {
  const problem = validateNotificationLink(link);
  if (problem) throw new Error(`assertNotificationLink: invalid notification link (${problem}): ${link}`);
  return link;
}

/**
 * 組出寫進 `notifications` 表的 row。
 * link 一律驗證；外部檔案下載請放 downloadUrl（前端會開新分頁）。
 */
export function buildNotificationRow(input: NotificationRowInput): {
  user_id: string;
  title: string;
  body: string;
  type: NotificationType;
  link: string | null;
  download_url?: string;
} {
  if (!input.userId) throw new Error('buildNotificationRow: userId is required');
  const link = input.link ? assertNotificationLink(input.link) : null;
  const row: {
    user_id: string; title: string; body: string; type: NotificationType;
    link: string | null; download_url?: string;
  } = {
    user_id: input.userId,
    title: input.title,
    body: input.body,
    type: input.type ?? 'info',
    link,
  };
  if (input.downloadUrl) row.download_url = input.downloadUrl;
  return row;
}
