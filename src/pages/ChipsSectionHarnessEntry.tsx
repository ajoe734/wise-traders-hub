// @ts-nocheck
/**
 * Preview-only E2E harness · ChipsSection
 *
 * URL: /e2e/chips-section?code=2330
 *   - code: 台股代碼；非台股（例：AAPL）用來測非渲染
 *
 * 網路請求全部由 Playwright `page.route('**\/tw-chips-detail**')` 攔截
 * 這個 harness 只是把 ChipsSection 掛到頁面上，其他都交給 spec。
 *
 * SECURITY: preview-only；prod 回傳 null。
 */
import { Suspense, lazy } from 'react';
import { WB } from '@/pages/_freeCheckup/constants.jsx';

const ChipsSection = lazy(
  () => import('@/checkup/components/freecheckup/ChipsSection'),
);

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

export default function ChipsSectionHarnessEntry() {
  if (!isPreviewEnv()) return null;
  const params = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.search : '',
  );
  const code = params.get('code') || '2330';

  return (
    <div
      data-testid="chips-harness-root"
      style={{
        background: WB?.bg || '#F5F3EF',
        color: WB?.ink || '#292520',
        padding: 20,
        maxWidth: 720,
        margin: '0 auto',
        fontFamily: '"Source Serif 4", "Noto Serif TC", Georgia, serif',
      }}
    >
      <div data-testid="chips-harness-code" style={{ fontSize: 11, letterSpacing: '0.14em' }}>
        HARNESS · code={code}
      </div>
      <Suspense fallback={<div data-testid="chips-harness-loading">loading harness…</div>}>
        <ChipsSection WB={WB} stockCode={code} />
      </Suspense>
    </div>
  );
}
