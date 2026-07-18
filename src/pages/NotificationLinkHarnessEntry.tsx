// @ts-nocheck
/**
 * Preview-only E2E harness for NotificationBell link routing.
 *
 * 提供三顆按鈕，分別觸發 `openNotificationLink` 三種輸入：
 *   - internal path（/account/notifications）
 *   - Supabase Storage signed URL（https://...）
 *   - null（不動作）
 *
 * 觀察值：
 *   - `[data-testid="nav-target"]`：react-router 目前所在 pathname + search
 *   - `[data-testid="external-url"]`：被 window.open 攔截到的外部 URL
 *   - `[data-testid="last-kind"]`：分流結果（internal/external/none）
 *
 * SECURITY: preview-only；prod 回傳 null。
 */
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { openNotificationLink } from '@/lib/openNotificationLink';

function isPreviewEnv() {
  try {
    const h = typeof window !== 'undefined' ? window.location.hostname : '';
    return (
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ||
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h.endsWith('.lovableproject.com') ||
      (h.startsWith('id-preview--') && h.endsWith('.lovable.app'))
    );
  } catch {
    return false;
  }
}

const INTERNAL_LINK = '/pricing?src=harness';
const EXTERNAL_LINK =
  'https://yqacmrgdjlenbijclngi.supabase.co/storage/v1/object/sign/journal-exports/demo.pdf?token=abc.def';

export default function NotificationLinkHarnessEntry() {
  if (!isPreviewEnv()) return null;
  const navigate = useNavigate();
  const location = useLocation();
  const [externalUrl, setExternalUrl] = useState<string>('');
  const [lastKind, setLastKind] = useState<string>('');

  const fire = (link: string | null) => {
    const kind = openNotificationLink(link, {
      navigate,
      openExternal: (url) => setExternalUrl(url), // 攔截，避免測試真的開新分頁
    });
    setLastKind(kind);
  };

  return (
    <div id="harness-root" style={{ padding: 24, background: '#fff', color: '#1a1a1a' }}>
      <h1 style={{ fontSize: 16, marginBottom: 12 }}>NotificationBell link routing harness</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 480 }}>
        <button data-testid="fire-internal" onClick={() => fire(INTERNAL_LINK)}>
          fire internal
        </button>
        <button data-testid="fire-external" onClick={() => fire(EXTERNAL_LINK)}>
          fire external
        </button>
        <button data-testid="fire-null" onClick={() => fire(null)}>
          fire null
        </button>
      </div>
      <dl style={{ marginTop: 16, fontFamily: 'monospace', fontSize: 12 }}>
        <dt>nav-target</dt>
        <dd data-testid="nav-target">{location.pathname + location.search}</dd>
        <dt>external-url</dt>
        <dd data-testid="external-url">{externalUrl || '(empty)'}</dd>
        <dt>last-kind</dt>
        <dd data-testid="last-kind">{lastKind || '(none)'}</dd>
      </dl>
    </div>
  );
}
