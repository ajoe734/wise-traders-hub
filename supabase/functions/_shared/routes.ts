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
