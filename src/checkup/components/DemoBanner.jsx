import { useState } from 'react';
import { DEMO_DATA_VERSION } from '@/checkup/data/demoDataVersion';

/**
 * Demo Banner — sticky 提示條，僅在 isDemo 時顯示。
 *
 * 緊湊化（demo 首屏可見性修復）：
 *  - 桌機目標高度 ≤ 60px、手機 ≤ 96px，避免擠掉持倉看板。
 *  - 文案、按鈕文字、stale 警示、onLineLogin/onEmailLogin 行為一律不動。
 */
export default function DemoBanner({ onLineLogin, onEmailLogin, C, alpha }) {
  const [collapsed, setCollapsed] = useState(false);

  const stale = (() => {
    if (!DEMO_DATA_VERSION) return false;
    const [y, m] = DEMO_DATA_VERSION.split('-').map(Number);
    if (!y || !m) return false;
    const dataDate = new Date(y, m - 1, 15);
    return Date.now() - dataDate.getTime() > 60 * 24 * 3600 * 1000;
  })();

  if (collapsed) {
    return (
      <div
        data-testid="demo-banner"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 12,
          background: C.bg,
          backgroundImage: `linear-gradient(${alpha(C.text, '06')}, ${alpha(C.text, '06')})`,
          borderBottom: `1px solid ${C.border}`,
          padding: '4px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 11,
          color: C.textMute,
          letterSpacing: '0.04em',
        }}
      >
        <span>DEMO 範例模式</span>
        <button
          onClick={() => setCollapsed(false)}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: C.textMute,
            fontSize: 11,
            padding: '2px 6px',
          }}
        >
          展開
        </button>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @media (max-width: 560px) {
          .lf-demo-banner { padding: 6px 12px !important; gap: 6px !important; }
          .lf-demo-banner-text { flex-basis: 100% !important; }
          .lf-demo-banner-title { font-size: 11px !important; margin-bottom: 2px !important; }
          .lf-demo-banner-desc { font-size: 10.5px !important; line-height: 1.45 !important; }
          .lf-demo-banner-actions { gap: 6px !important; }
          .lf-demo-banner-btn { padding: 4px 8px !important; font-size: 11px !important; }
        }
      `}</style>
      <div
        role="region"
        aria-label="DEMO 模式說明"
        data-testid="demo-banner"
        className="lf-demo-banner"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 12,
          background: C.bg,
          backgroundImage: `linear-gradient(${alpha(C.text, '06')}, ${alpha(C.text, '06')})`,
          borderBottom: `1px solid ${C.border}`,
          padding: '6px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div className="lf-demo-banner-text" style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div
            className="lf-demo-banner-title"
            style={{
              fontSize: 12,
              color: C.text,
              fontWeight: 500,
              letterSpacing: '0.02em',
              marginBottom: 2,
            }}
          >
            目前是 DEMO 範例模式
          </div>
          <div
            className="lf-demo-banner-desc"
            style={{
              fontSize: 11,
              color: C.textMute,
              lineHeight: 1.5,
              letterSpacing: '0.02em',
            }}
          >
            所有持倉、收盤分析、事件預測皆為示範資料。登入後即可使用你自己的真實持倉、AI 分析與策略大腦。
            {stale && (
              <span style={{ marginLeft: 6, color: alpha(C.text, '60') }}>
                · 示範資料更新中
              </span>
            )}
          </div>
        </div>
        <div className="lf-demo-banner-actions" style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
          <button
            onClick={onLineLogin}
            className="lf-demo-banner-btn"
            style={{
              background: '#06C755',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '5px 10px',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              letterSpacing: '0.02em',
            }}
          >
            LINE 登入解鎖
          </button>
          <button
            onClick={onEmailLogin}
            className="lf-demo-banner-btn"
            style={{
              background: 'transparent',
              color: C.text,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: '5px 10px',
              fontSize: 11,
              fontWeight: 400,
              cursor: 'pointer',
              letterSpacing: '0.02em',
            }}
          >
            Email 登入
          </button>
          <button
            onClick={() => setCollapsed(true)}
            aria-label="收合"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: C.textMute,
              fontSize: 15,
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      </div>
    </>
  );
}
