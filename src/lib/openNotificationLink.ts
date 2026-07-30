/**
 * 決定通知 link 的開啟方式：
 *   - 空值 → 不動作
 *   - http(s):// 開頭（例如 Supabase Storage signed URL）→ 新分頁開啟，避免 react-router
 *     把整段外部 URL 當成 SPA 相對路徑，走進 /notfound 造成 404。
 *   - 其他（例如 /account/notifications）→ 交給 react-router navigate。
 *
 * 額外偵測：
 *   - Supabase Storage signed URL 的 token 若已過期或格式錯誤，直接回報 error
 *     而不真的開新分頁（避免使用者跳到一頁「JWT expired」XML）。
 *   - `window.open` 被瀏覽器擋（回傳 null）→ 回報 popup_blocked 讓 UI 顯示 toast。
 */
import { normalizeNotificationPath } from './legacyRoutes';

export type NotificationLinkKind = 'none' | 'external' | 'internal';

export type NotificationLinkError =
  | 'invalid_url'
  | 'signed_url_expired'
  | 'signed_url_malformed'
  | 'popup_blocked'
  | 'open_failed';

export interface NotificationLinkResult {
  kind: NotificationLinkKind;
  error?: NotificationLinkError;
  message?: string;
}

export function classifyNotificationLink(link: string | null | undefined): NotificationLinkKind {
  if (!link) return 'none';
  if (/^https?:\/\//i.test(link)) return 'external';
  return 'internal';
}

/**
 * 檢查 Supabase Storage signed URL 是否過期或格式錯誤。
 * 回傳 null 代表看起來合法（或不是 signed URL，交由外部服務判斷）。
 */
export function validateSignedUrl(
  url: string,
  now: number = Date.now(),
): NotificationLinkError | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'invalid_url';
  }
  // 只針對 Supabase Storage signed URL 做嚴格檢查，其他外部連結不擋
  if (!/\/storage\/v[0-9]+\/object\/sign\//i.test(parsed.pathname)) return null;
  const token = parsed.searchParams.get('token');
  if (!token) return 'signed_url_malformed';
  const parts = token.split('.');
  if (parts.length < 2) return 'signed_url_malformed';
  try {
    const payloadStr = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadStr);
    if (typeof payload.exp === 'number' && payload.exp * 1000 < now) {
      return 'signed_url_expired';
    }
  } catch {
    return 'signed_url_malformed';
  }
  return null;
}

export interface OpenNotificationLinkDeps {
  navigate: (path: string, options?: { state?: unknown }) => void;
  /** 回傳 false / null 代表被瀏覽器擋，回傳 true 或 Window 代表成功。 */
  openExternal?: (url: string) => Window | null | boolean | void;
  onError?: (error: NotificationLinkError, message: string) => void;
  /** 在成功發起導向/開啟後觸發，供呼叫端埋 analytics。 */
  onOpen?: (info: { kind: 'internal' | 'external' }) => void;
  /** 傳給 react-router navigate 的 state，讓 NotFound 頁可以偵測 404 來源。 */
  navigateState?: unknown;
  now?: number;
}

const ERROR_MESSAGES: Record<NotificationLinkError, string> = {
  invalid_url: '通知連結格式錯誤，無法開啟。',
  signed_url_expired: '此下載連結已過期，請重新產生。',
  signed_url_malformed: '此下載連結格式異常，請聯繫客服。',
  popup_blocked: '瀏覽器已封鎖彈出視窗，請允許後再試一次。',
  open_failed: '無法開啟連結，請稍後再試。',
};

export function openNotificationLink(
  rawLink: string | null | undefined,
  { navigate, openExternal, onError, onOpen, navigateState, now }: OpenNotificationLinkDeps,
): NotificationLinkResult {
  // A6：歷史通知可能存了同站絕對網址或 legacy `/me/*` 路徑，
  // 先正規化成相對路徑再分流，避免整頁重載或落到 404。
  const link = normalizeNotificationPath(rawLink);
  const kind = classifyNotificationLink(link);
  if (kind === 'none') return { kind };


  if (kind === 'external') {
    const url = link as string;
    const validationError = validateSignedUrl(url, now);
    if (validationError) {
      const msg = ERROR_MESSAGES[validationError];
      onError?.(validationError, msg);
      return { kind, error: validationError, message: msg };
    }
    try {
      const open =
        openExternal ?? ((u: string) => window.open(u, '_blank', 'noopener,noreferrer'));
      const result = open(url);
      if (result === null || result === false) {
        const msg = ERROR_MESSAGES.popup_blocked;
        onError?.('popup_blocked', msg);
        return { kind, error: 'popup_blocked', message: msg };
      }
    } catch (e) {
      const msg = ERROR_MESSAGES.open_failed;
      onError?.('open_failed', msg);
      return { kind, error: 'open_failed', message: msg };
    }
    onOpen?.({ kind });
    return { kind };
  }

  navigate(link as string, navigateState !== undefined ? { state: navigateState } : undefined);
  onOpen?.({ kind });
  return { kind };
}
