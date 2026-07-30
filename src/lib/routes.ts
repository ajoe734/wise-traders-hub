/**
 * 全站路徑常數層（單一資料源）。
 * 目前只涵蓋續訂／結帳連結；其他路徑會逐票搬遷進來。
 */

export type AbsoluteUrlOptions = {
  /** 站台前綴，例如 https://legendflow.tw。省略則回傳相對路徑。 */
  baseUrl?: string;
};

const joinBase = (baseUrl: string | undefined, path: string): string => {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
};

/**
 * 續訂／結帳連結。
 * 必須指向公開的 `/checkout/:slug/:planId`，
 * 不可指向 `/app/checkout/*`（該路由有 subscriberOnly 守衛，已到期用戶會被擋住而無法續訂）。
 */
export const renewalUrl = (
  expertSlug: string,
  planId: string,
  options: AbsoluteUrlOptions = {},
): string => {
  if (!expertSlug) throw new Error('renewalUrl: expertSlug is required');
  if (!planId) throw new Error('renewalUrl: planId is required');
  const path = `/checkout/${encodeURIComponent(expertSlug)}/${encodeURIComponent(planId)}`;
  return joinBase(options.baseUrl, path);
};
