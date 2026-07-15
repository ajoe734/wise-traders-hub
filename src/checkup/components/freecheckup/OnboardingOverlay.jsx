import React, { useEffect, useState } from 'react';

/**
 * OnboardingOverlay — Batch C §6.5
 *
 * 首次進站全屏卡：三步驟 + LINE 登入 / 示範資料入口。
 * 已引導過（localStorage 'lf.checkup.onboarded' = '1'）則不顯示。
 */
const FLAG_KEY = 'lf.checkup.onboarded';

export default function OnboardingOverlay({ C, onStartLine, onStartDemo }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (window.localStorage.getItem(FLAG_KEY) !== '1') setOpen(true);
    } catch {}
  }, []);

  const close = (source) => {
    try { window.localStorage.setItem(FLAG_KEY, '1'); } catch {}
    setOpen(false);
    if (source === 'line') onStartLine?.();
    else if (source === 'demo') onStartDemo?.();
  };

  if (!open) return null;

  const steps = [
    { n: '01', k: '上傳', d: '把手上的成交截圖交給 AI' },
    { n: '02', k: '診斷', d: '每檔持股一份決策書' },
    { n: '03', k: '決策', d: '今日待辦・下次事件・目標價' },
  ];

  return (
    <div
      role="dialog" aria-modal="true" aria-label="開始使用"
      data-testid="checkup-onboarding"
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(10,10,10,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '5vh 16px', overflowY: 'auto',
      }}
    >
      <div style={{
        width: '100%', maxWidth: 560,
        background: C?.bg || '#fff',
        border: `1px solid ${C?.text || '#0A0A0A'}`,
        padding: '32px 30px 26px',
      }}>
        <div style={{
          fontFamily: "'Noto Serif TC', ui-serif, Georgia, serif",
          fontSize: 'clamp(20px, 4vw, 24px)', fontWeight: 600,
          color: C?.text || '#0A0A0A', lineHeight: 1.4, marginBottom: 6,
        }}>
          三步，把持倉變成每天的決策書
        </div>
        <div style={{ fontSize: 12, color: C?.textMute || '#9B968D', letterSpacing: '0.06em', marginBottom: 20 }}>
          Legendflow · Holding Checkup
        </div>

        <div style={{ display: 'grid', gap: 14, marginBottom: 24 }}>
          {steps.map(s => (
            <div key={s.n} style={{
              display: 'grid', gridTemplateColumns: '56px 1fr', gap: 14,
              paddingBottom: 12, borderBottom: `1px solid ${C?.border || '#ECEAE5'}`,
            }}>
              <div style={{
                fontFamily: "'Noto Serif TC', ui-serif, Georgia, serif",
                fontSize: 22, fontWeight: 600, color: '#FF4D1F',
                fontVariantNumeric: 'tabular-nums',
              }}>{s.n}</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: C?.text || '#0A0A0A', marginBottom: 2 }}>{s.k}</div>
                <div style={{ fontSize: 12, color: C?.textSec || '#6B6862', lineHeight: 1.6 }}>{s.d}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => close('line')}
            data-testid="onboarding-line-start"
            style={{
              flex: '1 1 200px', padding: '11px 16px',
              background: C?.text || '#0A0A0A', color: C?.bg || '#fff',
              border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 500, letterSpacing: '0.04em',
            }}
          >LINE 登入開始</button>
          <button
            type="button"
            onClick={() => close('demo')}
            data-testid="onboarding-demo-start"
            style={{
              flex: '1 1 160px', padding: '11px 16px',
              background: 'transparent', color: C?.text || '#0A0A0A',
              border: `1px solid ${C?.border || '#ECEAE5'}`, cursor: 'pointer',
              fontSize: 13, fontWeight: 500, letterSpacing: '0.04em',
            }}
          >先看示範資料</button>
        </div>

        <button
          type="button"
          onClick={() => close()}
          style={{
            marginTop: 16, background: 'transparent', border: 'none',
            color: C?.textMute || '#9B968D', fontSize: 11, cursor: 'pointer',
            padding: 0, letterSpacing: '0.04em',
          }}
        >稍後 ×</button>
      </div>
    </div>
  );
}
