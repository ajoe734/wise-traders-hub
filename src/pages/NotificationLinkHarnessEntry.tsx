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
import { SUPABASE_BASE_URL } from "@/lib/supabaseEndpoint";

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
// 端點不可硬寫 project id（clone build 會被誤導向 production）
const STORAGE_SIGN_BASE = `${SUPABASE_BASE_URL}/storage/v1/object/sign/journal-exports`;
// 未過期 signed URL：預設 fire-external 用它，方便既有「新分頁開啟」測試沿用
const EXTERNAL_LINK =
  `${STORAGE_SIGN_BASE}/demo.pdf?token=h.` +
  btoa(JSON.stringify({ exp: 2000000000 })).replace(/=+$/, '');
const VALID_SIGNED = EXTERNAL_LINK;
// exp=1000000000 (2001) → 已過期
const EXPIRED_SIGNED =
  `${STORAGE_SIGN_BASE}/old.pdf?token=h.` +
  btoa(JSON.stringify({ exp: 1000000000 })).replace(/=+$/, '');
const MALFORMED_SIGNED =
  `${STORAGE_SIGN_BASE}/x.pdf?token=not-a-jwt`;
// WHATWG URL 解析器對 `https://[...` 這種畸形 host 會直接 throw
const INVALID_URL = 'https://[bad-host';

export default function NotificationLinkHarnessEntry() {
  if (!isPreviewEnv()) return null;
  const navigate = useNavigate();
  const location = useLocation();
  const [externalUrl, setExternalUrl] = useState<string>('');
  const [lastKind, setLastKind] = useState<string>('');
  const [lastError, setLastError] = useState<string>('');
  const [lastMessage, setLastMessage] = useState<string>('');
  const [popupBlocked, setPopupBlocked] = useState(false);

  const fire = (link: string | null) => {
    setExternalUrl('');
    setLastError('');
    setLastMessage('');
    const result = openNotificationLink(link, {
      navigate,
      openExternal: (url) => {
        if (popupBlocked) return null; // 模擬瀏覽器擋彈窗
        setExternalUrl(url);
        return true;
      },
      onError: (error, message) => {
        setLastError(error);
        setLastMessage(message);
      },
    });
    setLastKind(result.kind);
  };

  return (
    <div id="harness-root" style={{ padding: 24, background: '#fff', color: '#1a1a1a' }}>
      <h1 style={{ fontSize: 16, marginBottom: 12 }}>NotificationBell link routing harness</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 480 }}>
        <button data-testid="fire-internal" onClick={() => fire(INTERNAL_LINK)}>fire internal</button>
        <button data-testid="fire-external" onClick={() => fire(EXTERNAL_LINK)}>fire external</button>
        <button data-testid="fire-null" onClick={() => fire(null)}>fire null</button>
        <button data-testid="fire-valid-signed" onClick={() => fire(VALID_SIGNED)}>fire valid signed</button>
        <button data-testid="fire-expired-signed" onClick={() => fire(EXPIRED_SIGNED)}>fire expired signed</button>
        <button data-testid="fire-malformed-signed" onClick={() => fire(MALFORMED_SIGNED)}>fire malformed signed</button>
        <button data-testid="fire-invalid-url" onClick={() => fire(INVALID_URL)}>fire invalid url</button>
        <label>
          <input
            type="checkbox"
            data-testid="toggle-popup-blocked"
            checked={popupBlocked}
            onChange={(e) => setPopupBlocked(e.target.checked)}
          />
          simulate popup blocked
        </label>
      </div>
      <dl style={{ marginTop: 16, fontFamily: 'monospace', fontSize: 12 }}>
        <dt>nav-target</dt>
        <dd data-testid="nav-target">{location.pathname + location.search}</dd>
        <dt>external-url</dt>
        <dd data-testid="external-url">{externalUrl || '(empty)'}</dd>
        <dt>last-kind</dt>
        <dd data-testid="last-kind">{lastKind || '(none)'}</dd>
        <dt>last-error</dt>
        <dd data-testid="last-error">{lastError || '(none)'}</dd>
        <dt>last-message</dt>
        <dd data-testid="last-message">{lastMessage || '(none)'}</dd>
      </dl>
    </div>
  );
}
