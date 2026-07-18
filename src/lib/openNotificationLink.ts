/**
 * 決定通知 link 的開啟方式：
 *   - 空值 → 不動作
 *   - http(s):// 開頭（例如 Supabase Storage signed URL）→ 新分頁開啟，避免 react-router
 *     把整段外部 URL 當成 SPA 相對路徑，走進 /notfound 造成 404。
 *   - 其他（例如 /account/notifications）→ 交給 react-router navigate。
 *
 * 抽出成純函式方便 e2e/單元測試在不掛整個 AuthProvider 的情況下驗證分流。
 */
export type NotificationLinkKind = 'none' | 'external' | 'internal';

export function classifyNotificationLink(link: string | null | undefined): NotificationLinkKind {
  if (!link) return 'none';
  if (/^https?:\/\//i.test(link)) return 'external';
  return 'internal';
}

export interface OpenNotificationLinkDeps {
  navigate: (path: string) => void;
  openExternal?: (url: string) => void;
}

export function openNotificationLink(
  link: string | null | undefined,
  { navigate, openExternal }: OpenNotificationLinkDeps,
): NotificationLinkKind {
  const kind = classifyNotificationLink(link);
  if (kind === 'external') {
    const open = openExternal ?? ((url: string) => window.open(url, '_blank', 'noopener,noreferrer'));
    open(link as string);
  } else if (kind === 'internal') {
    navigate(link as string);
  }
  return kind;
}
