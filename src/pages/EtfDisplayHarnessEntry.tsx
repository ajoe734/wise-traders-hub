// @ts-nocheck
/**
 * Preview-only E2E harness for ETF 代號+名稱 換行/字寬視覺回歸。
 *
 * 複刻 JournalDetail 列表列與 SignalDetail 標題列所使用的 className / DOM
 * 結構（split 為 font-mono 代號 + 中文名），讓 Playwright 能在多寬度下
 * 驗證：
 *   1. 容器不會產生水平溢出（scrollWidth <= clientWidth）
 *   2. 代號與名稱文字都完整存在、可見（getBoundingClientRect 非零）
 *
 * SECURITY: gated to preview envs only.
 */
import { useMemo } from 'react';

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

/**
 * 完整複製生產程式碼的 className，只要生產端 CSS 規則變更，harness 就會同步失效。
 * — src/pages/app/JournalDetail.tsx L75-92
 * — src/pages/app/SignalDetail.tsx L148-165
 * — src/pages/_adminSignals/SignalCreateDialog.tsx L588-598
 */
function JournalDetailRow({ code, name }: { code: string; name: string }) {
  return (
    <div className="px-4 py-3 border rounded">
      <div className="flex items-center gap-3">
        <span
          data-testid="jd-badge"
          className="shrink-0 inline-flex items-center rounded bg-slate-900 text-white text-xs px-2 py-0.5"
        >
          買
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              data-testid="jd-instrument"
              className="font-medium text-sm min-w-0 break-words [overflow-wrap:anywhere]"
              title={`${code} ${name}`}
            >
              <span data-testid="jd-code" className="font-mono tabular-nums tracking-tight">{code}</span>
              {name && (
                <>
                  {' '}
                  <span data-testid="jd-name">{name}</span>
                </>
              )}
            </span>
            <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">08/15</span>
            <span className="text-xs text-foreground/80 font-medium whitespace-nowrap shrink-0">
              價 NT$1,234
              <span className="mx-1 text-muted-foreground">·</span>
              10 張
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SignalDetailHeader({ code, name }: { code: string; name: string }) {
  return (
    <div data-testid="sd-row" className="flex items-start gap-3 flex-wrap">
      <span
        data-testid="sd-badge"
        className="shrink-0 mt-1 inline-flex items-center rounded bg-green-600 text-white text-xs px-2 py-0.5"
      >
        買進
      </span>
      <h1
        data-testid="sd-instrument"
        className="text-2xl font-bold min-w-0 break-words [overflow-wrap:anywhere] leading-tight"
      >
        <span data-testid="sd-code" className="font-mono tabular-nums tracking-tight">{code}</span>
        {name ? (
          <>
            {' '}
            <span data-testid="sd-name">{name}</span>
          </>
        ) : (
          <span className="text-muted-foreground">.TW</span>
        )}
      </h1>
    </div>
  );
}

export default function EtfDisplayHarnessEntry() {
  if (!isPreviewEnv()) return null;
  const { code, name } = useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    return {
      code: (p.get('code') || '00631L').toUpperCase(),
      name: p.get('name') || '元大台灣50正2',
    };
  }, []);

  return (
    <div
      id="etf-display-harness-root"
      // 讓 harness 完整佔滿視窗寬度，模擬真實 UnifiedAppLayout 的行動裝置排版
      style={{ padding: 16, background: '#fff', color: '#1a1a1a', minHeight: '100vh', width: '100%', boxSizing: 'border-box', fontFamily: 'system-ui' }}
    >
      <section data-testid="section-journal-detail" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>JournalDetail row</h2>
        <JournalDetailRow code={code} name={name} />
      </section>

      <section data-testid="section-signal-detail">
        <h2 style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>SignalDetail header</h2>
        <SignalDetailHeader code={code} name={name} />
      </section>
    </div>
  );
}
