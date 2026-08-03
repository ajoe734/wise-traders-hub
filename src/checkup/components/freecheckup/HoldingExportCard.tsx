// @ts-nocheck
// 持倉抽屜「匯出卡」— 離屏渲染，僅用於 PNG/PDF 截圖。
// 兩種版型：square（1080×1080）、wide（1920×1080，左大數 + 右資訊欄）。
// 不依賴 SHARE MODE，永遠帶 legendflow.tw 浮水印與時間戳。
import React from 'react';

const FONT_STACK = '"Noto Sans TC","Source Sans 3","Helvetica Neue",Helvetica,Arial,sans-serif';
const SERIF = '"Source Serif 4",Georgia,serif';

export default function HoldingExportCard({
  variant = 'square',
  holding,
  decision,
  meta,
  scenario,
  baseTarget,
  pctVal,
  pnlVal,
  rangeLow,
  rangeHigh,
  thesis,
  reversalLine = null,
  closeStatusText = null,
  nextEvent,
  stamp,
  WB,
}) {
  const isWide = variant === 'wide';
  const W = isWide ? 1920 : 1080;
  const H = isWide ? 1080 : 1080;
  const padX = isWide ? 96 : 80;
  const padY = isWide ? 80 : 80;

  const pnlColor = pctVal > 0 ? WB.accent : pctVal < 0 ? '#8A857F' : WB.inkMute;
  const actionLabel = decision?.actionType === 'exit' ? 'EXIT' : decision?.actionType === 'review' ? 'REVIEW' : 'HOLD';
  const tp = scenario?.simTarget ?? baseTarget;
  // Bug B8 fix：對 price=0 或 NaN 需明確判斷，否則 upside 會出現 Infinity/NaN
  const _priceForUpside = Number(holding?.price);
  const upside = scenario?.upsidePct
    ?? (tp != null && Number.isFinite(_priceForUpside) && _priceForUpside > 0
          ? ((tp - _priceForUpside) / _priceForUpside) * 100
          : null);

  const Big = ({ children, color = WB.ink, size = 220 }) => (
    <div style={{
      fontSize: size, fontWeight: 600, color, lineHeight: 0.92,
      letterSpacing: '-0.035em', fontVariantNumeric: 'tabular-nums',
    }}>{children}</div>
  );

  return (
    <div
      data-export-card
      data-variant={variant}
      style={{
      width: W, height: H, background: WB.surface, color: WB.ink,
      fontFamily: FONT_STACK, padding: `${padY}px ${padX}px`,
      boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* 識別 */}
      <div style={{ marginBottom: isWide ? 24 : 28 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <span style={{ fontSize: 22, color: WB.inkMute, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.04em' }}>{holding.code}</span>
          <span style={{ fontSize: isWide ? 64 : 56, fontWeight: 600, letterSpacing: '-0.015em' }}>{holding.name}</span>
        </div>
        {(meta?.industry || meta?.strategy) && (
          <div style={{ marginTop: 8, fontSize: 16, color: WB.inkMute, letterSpacing: '0.04em' }}>
            {meta?.industry || ''}{meta?.industry && meta?.strategy ? '  ·  ' : ''}{meta?.strategy || ''}
          </div>
        )}
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: isWide ? '1.1fr 1fr' : '1fr', gap: isWide ? 64 : 36 }}>
        {/* 左：報酬大數 + DECISION */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={labelLg(WB)}>RETURN</div>
            <Big color={pnlColor} size={isWide ? 240 : 200}>
              {pctVal >= 0 ? '+' : ''}{Number(pctVal).toFixed(2)}
              <span style={{ fontSize: isWide ? 80 : 64, opacity: 0.55, marginLeft: 8 }}>%</span>
            </Big>
            <div style={{ marginTop: 20, fontSize: 22, color: WB.inkSub, fontVariantNumeric: 'tabular-nums' }}>
              {pnlVal >= 0 ? '+' : ''}{Math.round(pnlVal).toLocaleString()}
            </div>
          </div>

          {/* DECISION 卡 */}
          <div style={{
            background: WB.ink, color: '#F4F1EC', padding: '28px 32px', borderRadius: 4,
            marginTop: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24,
          }}>
            <div>
              <div style={{ fontSize: 14, color: 'rgba(244,241,236,0.55)', letterSpacing: '0.22em', fontWeight: 600 }}>DECISION</div>
              <div style={{ fontSize: 64, fontWeight: 600, color: WB.accent, letterSpacing: '0.04em', marginTop: 8, lineHeight: 1 }}>{actionLabel}</div>
            </div>
            {tp && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, color: 'rgba(244,241,236,0.55)', letterSpacing: '0.20em', fontWeight: 600 }}>TARGET</div>
                <div style={{ fontSize: 36, fontWeight: 600, color: '#F4F1EC', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{Number(tp).toLocaleString()}</div>
                {upside != null && (
                  <div style={{ fontSize: 18, color: upside >= 0 ? WB.accent : '#D4CFC9', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                    {upside >= 0 ? '+' : ''}{upside.toFixed(1)}% upside
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 右：資訊欄（square 與 wide 都顯示，wide 拉開更多）*/}
        <div style={{ display: 'flex', flexDirection: 'column', gap: isWide ? 24 : 18 }}>
          <Row label="成本 → 現價" value={
            <>
              {fmt(holding.cost)}<span style={{ color: WB.inkLight, margin: '0 10px' }}>→</span>
              <span style={{ fontWeight: 600 }}>{fmt(holding.price)}</span>
            </>
          } WB={WB} />
          <Row label="數量 · 市值" value={`${fmtInt(holding.qty)} · ${fmtInt(holding.price * holding.qty)}`} WB={WB} />
          {(rangeLow != null && rangeHigh != null) && (
            <Row label="近 30D 區間" value={`${rangeLow.toFixed(2)} — ${rangeHigh.toFixed(2)}`} WB={WB} />
          )}
          {closeStatusText && (
            <div data-export-close-status style={{ fontSize: 18, color: WB.inkMute, lineHeight: 1.5 }}>
              {closeStatusText}
            </div>
          )}
          {/* 轉折觀察：與抽屜同一條文案；無訊號不預留高度 */}
          {reversalLine && (
            <div data-export-reversal style={{ fontSize: 20, color: WB.inkSub, lineHeight: 1.5 }}>
              <span style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                background: WB.inkMute, marginRight: 10, verticalAlign: 'middle',
              }} />
              {reversalLine}
            </div>
          )}

          {thesis && (
            <div style={{
              marginTop: 8, padding: '20px 24px',
              borderLeft: `4px solid ${WB.accent}`, background: WB.surfaceSoft,
              borderRadius: 3,
            }}>
              <div style={labelLg(WB)}>THESIS</div>
              <div style={{ marginTop: 10, fontFamily: SERIF, fontSize: 22, lineHeight: 1.6, color: WB.ink }}>「{thesis}」</div>
            </div>
          )}

          {nextEvent && (
            <div style={{ padding: '18px 22px', border: `1px solid ${WB.hair}`, borderRadius: 3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={labelLg(WB)}>NEXT EVENT</span>
                {nextEvent.date && <span style={{ fontSize: 12, color: WB.surface, background: WB.accent, padding: '3px 10px', letterSpacing: '0.18em', fontWeight: 700, borderRadius: 2 }}>{nextEvent.date}</span>}
              </div>
              <div style={{ marginTop: 8, fontSize: 18, color: WB.inkSub, lineHeight: 1.55 }}>{nextEvent.summary || nextEvent.title}</div>
            </div>
          )}
        </div>
      </div>

      {/* 品牌分享落款（唯一一處，≤40px 高） */}
      <div data-export-footer style={{
        marginTop: 24, paddingTop: 14, borderTop: `1px solid ${WB.hair}`,
        height: 36, boxSizing: 'border-box',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 14, color: WB.inkMute, letterSpacing: '0.06em',
      }}>
        <span>
          <span style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 600, color: WB.ink }}>
            legendflow<span style={{ color: WB.accent }}>.</span>tw
          </span>
          <span style={{ margin: '0 10px', color: WB.inkLight }}>·</span>
          也來檢查你的持倉
        </span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{stamp}</span>
      </div>
    </div>
  );
}

function labelLg(WB) {
  return { fontSize: 13, color: WB.inkLight, letterSpacing: '0.22em', fontWeight: 700 };
}
function Row({ label, value, WB }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: `1px solid ${WB.hair}`, paddingBottom: 12 }}>
      <span style={{ fontSize: 13, color: WB.inkLight, letterSpacing: '0.18em', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 22, color: WB.inkSub, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}
function fmt(v) { return Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—'; }
function fmtInt(v) { return Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString() : '—'; }
