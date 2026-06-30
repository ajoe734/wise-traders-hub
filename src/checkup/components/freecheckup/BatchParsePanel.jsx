// 批次解析狀態面板：進度條、取消、項目清單、重試
// 在 TradeTab 與 HoldingsTab 上方共用
import React from 'react';
import { alpha } from '@/checkup/theme';

const STATUS_META = {
  pending:   { label: '等待中', color: '#8A857C', icon: '○' },
  parsing:   { label: '解析中', color: '#C97B3A', icon: '◐' },
  success:   { label: '已完成', color: '#2E7D5C', icon: '✓' },
  failed:    { label: '失敗',   color: '#B33A3A', icon: '✗' },
  cancelled: { label: '已取消', color: '#8A857C', icon: '—' },
};

export default function BatchParsePanel({
  C,
  batchState,
  cancelBatch,
  retryBatchFailures,
  restoreBatchItemPreview,
  variant = 'trade', // 'trade' | 'holdings'
}) {
  if (!batchState || !batchState.items?.length) return null;
  const { items, currentIndex, total, running, cancelled } = batchState;
  const done = items.filter(it => it.status === 'success' || it.status === 'failed' || it.status === 'cancelled').length;
  const failed = items.filter(it => it.status === 'failed').length;
  const cancelledCount = items.filter(it => it.status === 'cancelled').length;
  const ok = items.filter(it => it.status === 'success').length;
  const progressPct = Math.round((done / total) * 100);
  const headerLabel = running
    ? `批次解析中（${currentIndex}/${total}）`
    : cancelled
      ? `已停止：成功 ${ok}、失敗 ${failed}、取消 ${cancelledCount}`
      : (failed > 0 ? `批次完成：成功 ${ok}、失敗 ${failed}` : `批次解析完成 ${ok}/${total}`);

  return (
    <div data-testid="batch-parse-panel" style={{
      border: `1px solid ${C?.border || '#E5E0D8'}`,
      borderRadius: 12,
      background: C?.card || '#FFFFFF',
      padding: '14px 16px',
      marginBottom: 14,
      position: 'relative',
      zIndex: 10001, // 高於 TradeTab parsing overlay (9999) 與抽屜，讓「停止/重試」始終可點
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div data-testid="batch-parse-header" style={{ fontSize: 14, fontWeight: 700, color: C?.text || '#292520' }}>
          {headerLabel}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {running && (
            <button data-testid="batch-cancel-btn" onClick={cancelBatch} style={{
              padding: '6px 12px', borderRadius: 8, border: `1px solid ${C?.border || '#E5E0D8'}`,
              background: '#FFF', color: '#B33A3A', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>停止批次</button>
          )}
          {!running && (failed > 0 || cancelledCount > 0) && (
            <button data-testid="batch-retry-btn" onClick={retryBatchFailures} style={{
              padding: '6px 12px', borderRadius: 8, border: '1px solid #C97B3A',
              background: '#C97B3A', color: '#FFF', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>重試失敗 {failed + cancelledCount} 張</button>
          )}
        </div>
      </div>

      {/* 進度條 */}
      <div style={{
        marginTop: 10, height: 6, borderRadius: 999,
        background: alpha(C?.text || '#292520', '12'),
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${progressPct}%`, height: '100%',
          background: running ? '#C97B3A' : (failed > 0 ? '#B33A3A' : '#2E7D5C'),
          transition: 'width 0.3s ease',
        }} />
      </div>
      <div style={{ marginTop: 4, fontSize: 11, color: C?.textMute || '#8A857C', letterSpacing: '0.04em' }}>
        進度 {done}/{total}（{progressPct}%）
      </div>

      {/* 項目清單 */}
      <div style={{
        marginTop: 10,
        maxHeight: 220, overflowY: 'auto',
        border: `1px solid ${alpha(C?.text || '#292520', '08')}`,
        borderRadius: 8,
      }}>
        {items.map((it) => {
          const meta = STATUS_META[it.status] || STATUS_META.pending;
          const clickable = !!restoreBatchItemPreview && (it.previewUrl || it.error);
          return (
            <div
              key={it.id}
              onClick={clickable ? () => restoreBatchItemPreview(it) : undefined}
              title={clickable ? '點擊回到此截圖預覽或檢視錯誤' : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px',
                borderBottom: `1px solid ${alpha(C?.text || '#292520', '06')}`,
                cursor: clickable ? 'pointer' : 'default',
                background: it.status === 'parsing' ? alpha('#C97B3A', '08') : 'transparent',
              }}
            >
              {it.previewUrl ? (
                <img src={it.previewUrl} alt="" style={{
                  width: 36, height: 36, objectFit: 'cover',
                  borderRadius: 4, border: `1px solid ${C?.border || '#E5E0D8'}`,
                  flexShrink: 0,
                }} />
              ) : (
                <div style={{ width: 36, height: 36, borderRadius: 4, background: alpha(C?.text || '#292520', '08'), flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 600,
                  color: C?.text || '#292520',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{it.name}</div>
                {it.error && (
                  <div style={{ fontSize: 11, color: '#B33A3A', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.error}
                  </div>
                )}
              </div>
              <div style={{
                fontSize: 12, fontWeight: 700,
                color: meta.color, flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <span>{meta.icon}</span>
                <span>{meta.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
