import React from 'react';

/**
 * DemoFooterHint — Batch C §6.5
 * 取代原本散落各 tab 頂部的 Demo/LINE banner。只在頁腳留一行。
 */
export default function DemoFooterHint({ isDemo, C, onStartLine, onStartEmail }) {
  if (!isDemo) return null;
  return (
    <div
      data-testid="demo-footer-hint"
      style={{
        marginTop: 24, padding: '12px 16px',
        borderTop: `1px solid ${C?.border || '#ECEAE5'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 10,
        fontSize: 11, color: C?.textMute || '#9B968D', letterSpacing: '0.04em',
      }}
    >
      <span>示範資料 · 尚未登入</span>
      <span style={{ display: 'inline-flex', gap: 14 }}>
        <button
          type="button" onClick={onStartLine}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C?.text || '#0A0A0A', fontSize: 11 }}
        >LINE 登入 →</button>
        <button
          type="button" onClick={onStartEmail}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C?.textSec || '#6B6862', fontSize: 11 }}
        >Email 登入</button>
      </span>
    </div>
  );
}
