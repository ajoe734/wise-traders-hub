import { useState } from 'react';
import { DEMO_DATA_VERSION } from '@/checkup/data/demoData';

/**
 * Demo Banner — sticky 提示條，僅在 isDemo 時顯示。
 * 設計遵循 Kore-eda 極簡：off-white 背景、無陰影、字重 400、文字 ≤ 13px。
 *
 * Props:
 *   onLineLogin: () => void   // LINE 登入解鎖
 *   onEmailLogin: () => void  // Email 登入
 *   C: ThemeC                 // 沿用 FreeCheckup 的 theme 物件
 *   alpha: (color, hex) => string
 */
export default function DemoBanner({ onLineLogin, onEmailLogin, C, alpha }) {
  const [collapsed, setCollapsed] = useState(false);

  // 計算示範資料版本是否過期（>60 天）
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
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 12,
          background: C.bg,
          backgroundImage: `linear-gradient(${alpha(C.text, '06')}, ${alpha(C.text, '06')})`,
          borderBottom: `1px solid ${C.border}`,
          padding: '6px 16px',
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
    <div
      role="region"
      aria-label="DEMO 模式說明"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 12,
        background: C.bg,
        backgroundImage: `linear-gradient(${alpha(C.text, '06')}, ${alpha(C.text, '06')})`,
        borderBottom: `1px solid ${C.border}`,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            color: C.text,
            fontWeight: 500,
            letterSpacing: '0.02em',
            marginBottom: 4,
          }}
        >
          目前是 DEMO 範例模式
        </div>
        <div
          style={{
            fontSize: 11,
            color: C.textMute,
            lineHeight: 1.6,
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
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={onLineLogin}
          style={{
            background: '#06C755',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            letterSpacing: '0.02em',
          }}
        >
          LINE 登入解鎖
        </button>
        <button
          onClick={onEmailLogin}
          style={{
            background: 'transparent',
            color: C.text,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: '6px 12px',
            fontSize: 12,
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
            fontSize: 16,
            padding: '0 4px',
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
