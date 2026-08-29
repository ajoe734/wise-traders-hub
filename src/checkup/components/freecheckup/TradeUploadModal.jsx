import React, { useEffect, useRef } from 'react';
import TradeTab from './TradeTab';

/**
 * TradeUploadModal — Batch C §6.3
 *
 * 把原 tab='trade' 的 TradeTab 包成置中 modal。
 * 由頂欄 / 手機底欄的「＋ 新增成交」CTA 開啟；ESC / 背景 / × 關閉。
 * TradeTab 內部 DOM 完全保留，e2e 選擇器不變。
 */
export default function TradeUploadModal({ open, onClose, C, alpha, quota, formatResetCountdown, tradeProps }) {
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = typeof document !== 'undefined' ? document.activeElement : null;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    // simple focus trap: focus the dialog
    setTimeout(() => dialogRef.current?.focus?.(), 0);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      try { previouslyFocused.current?.focus?.(); } catch {}
    };
  }, [open, onClose]);

  if (!open) return null;

  const remaining = Math.max((quota?.limit || 0) - (quota?.used || 0), 0);
  const reset = quota?.resets_at ? formatResetCountdown?.(quota.resets_at) : '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="新增成交"
      data-testid="trade-upload-modal"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(10,10,10,0.18)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '4vh 16px',
        overflowY: 'auto',
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 620,
          background: C?.bg,
          border: `1px solid ${C?.text}`,
          outline: 'none',
        }}
      >
        {/* header */}
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          padding: '18px 22px 12px',
          borderBottom: `1px solid ${C?.border}`,
        }}>
          <div style={{
            fontFamily: "'Noto Serif TC', ui-serif, Georgia, serif",
            fontSize: 22, fontWeight: 600, color: C?.text,
            letterSpacing: '0.02em',
          }}>新增成交</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <div style={{ fontSize: 11, color: C?.textMute, fontVariantNumeric: 'tabular-nums' }}>
              {quota ? <>今日餘 <span style={{ color: C?.text }}>{remaining}</span> 次{reset ? ` · ${reset}` : ''}</> : null}
            </div>
            <button
              type="button" aria-label="關閉"
              onClick={onClose}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: C?.textMute, fontSize: 20, padding: 0, lineHeight: 1,
              }}
            >×</button>
          </div>
        </div>

        {/* body — original TradeTab; internal DOM & data-testid preserved */}
        <div style={{ padding: '14px 18px 6px' }}>
          <TradeTab {...tradeProps} />
        </div>

        {/* footer editorial hint */}
        <div style={{
          padding: '10px 22px 14px',
          borderTop: `1px solid ${C?.border}`,
          fontSize: 11, color: C?.textMute, lineHeight: 1.7,
          display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        }}>
          <span>可上傳截圖或切換手動輸入 · 解析、去重、備忘三問沿用既有流程</span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', color: C?.textSec,
              cursor: 'pointer', fontSize: 11, letterSpacing: '0.04em',
            }}
          >關閉 ×</button>
        </div>
      </div>
    </div>
  );
}
