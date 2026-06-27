// @ts-nocheck
import React, { useMemo, useRef, useState } from 'react';
import { Camera, Download, Copy, X as XIcon } from 'lucide-react';
import { useHoldingShareExport } from '@/checkup/hooks/useHoldingShareExport';
import { Sparkline } from '@/pages/_freeCheckup/constants.jsx';

/**
 * HoldingsDetailPanel — 持倉抽屜（重設計版）
 *
 * 目標：兼具資訊密度與美感，可一鍵截圖分享。
 *
 * 三層架構：
 *   操作層：頂部 nav (‹ › ×)、分享按鈕 — Share Mode 自動隱藏
 *   焦點層：code/name + sparkline + PnL 主數 + DECISION inline 卡
 *   脈絡層：成本/現價/數量、區間高低、佔比、目標、THESIS、NEXT EVENT
 *   浮水印：legendflow.tw + 日期戳（Share Mode 才出現）
 *
 * 截圖：用 html-to-image 把 shareRef 對應的容器轉 PNG，
 *       支援下載與剪貼簿；不支援剪貼簿的瀏覽器 fallback 下載。
 */
function HoldingsDetailPanelImpl({
  selected,
  decisionsMap = {},
  stockMeta = {},
  targets,
  avgTarget,
  normalizedEvents = [],
  orderedDisplayed = [],
  WB,
  setExpandedDecision,
  openHoldingDrawer,
  totalPortfolioValue = 0,
  sparkData30D = [],
}) {
  const [shareMode, setShareMode] = useState(false);
  const shareRef = useRef<HTMLDivElement | null>(null);
  const { busy, download, copy } = useHoldingShareExport({ backgroundColor: WB.surface });

  if (!selected) return null;
  const h = selected;
  const dec = decisionsMap[h.code];
  const meta = stockMeta[h.code] || null;
  const T = targets?.[h.code];
  const tp = T && avgTarget ? avgTarget(h.code) : null;
  const upside = tp && h.price ? ((tp - h.price) / h.price * 100) : null;
  const actionLabel = dec?.actionType === 'exit' ? 'EXIT' : dec?.actionType === 'review' ? 'REVIEW' : 'HOLD';
  const pctVal = h.pct ?? h.totalPct ?? 0;
  const pnlVal = Number(h.pnl ?? h.totalPnl ?? 0);
  const urgencyLevel = dec?.urgency === 'now' ? 4 : dec?.urgency === 'soon' ? 3 : dec?.urgency === 'monitor' ? 2 : 1;
  const urgencyLabel = dec?.urgency === 'now' ? 'NOW' : dec?.urgency === 'soon' ? 'SOON' : dec?.urgency === 'monitor' ? 'MONITOR' : 'LOW';

  const relatedEvents = (normalizedEvents || [])
    .filter((e) => (e.relatedCodes || []).includes(h.code) && e.source !== 'demo')
    .slice(0, 5);
  const nextEvent = relatedEvents[0];

  const visibleList = orderedDisplayed;
  const curIdx = visibleList.findIndex((x) => x.code === h.code);
  const prev = curIdx > 0 ? visibleList[curIdx - 1] : null;
  const next = curIdx < visibleList.length - 1 ? visibleList[curIdx + 1] : null;

  // ── 衍生欄位 ──
  const todayPct = Number.isFinite(Number(h.changePct)) ? Number(h.changePct) : null;
  const todayPnl = Number.isFinite(Number(h.todayPnl)) ? Number(h.todayPnl) : null;
  const valueNum = Number(h.value ?? (Number(h.price) * Number(h.qty)) ?? 0);
  const weightPct = totalPortfolioValue > 0 && valueNum > 0 ? (valueNum / totalPortfolioValue) * 100 : null;
  const sparkArr = useMemo(() => (Array.isArray(sparkData30D) ? sparkData30D.filter((n) => Number.isFinite(n)) : []), [sparkData30D]);
  const rangeLow = sparkArr.length ? Math.min(...sparkArr) : null;
  const rangeHigh = sparkArr.length ? Math.max(...sparkArr) : null;
  const thesisSentence = useMemo(() => {
    const raw = dec?.actionText || meta?.strategy || '';
    if (!raw) return '';
    const m = String(raw).match(/^(.*?[。.!?！？])/);
    return (m ? m[1] : raw).slice(0, 90);
  }, [dec, meta]);

  const pnlColor = pctVal > 0 ? WB.accent : pctVal < 0 ? '#8A857F' : WB.inkMute;
  const stamp = useMemo(() => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, [shareMode]); // 進 share mode 時更新一次

  const handleDownload = () => {
    const node = shareRef.current;
    if (!node) return;
    const safeName = (h.name || h.code).replace(/[\\/:*?"<>|]/g, '');
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    download(node, `${h.code}-${safeName}-${ymd}.png`);
  };

  // ───────── Inline styles helpers ─────────
  const labelStyle = { fontSize: 9, color: WB.inkLight, letterSpacing: '0.18em', fontWeight: 600 };
  const microStyle = { fontSize: 10, color: WB.inkMute, letterSpacing: '0.04em' };

  return (
    <div>
      {/* 操作列：Share Mode 隱藏 */}
      {!shareMode && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderBottom: `1px solid ${WB.hair}`,
        }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => prev && setExpandedDecision(prev.code)}
              disabled={!prev}
              aria-label="上一檔"
              style={{ width: 26, height: 26, border: `1px solid ${WB.hair}`, background: 'transparent', cursor: prev ? 'pointer' : 'not-allowed', color: prev ? WB.ink : WB.inkLight, fontSize: 12, borderRadius: 2, fontFamily: 'inherit' }}
            >‹</button>
            <button
              onClick={() => next && setExpandedDecision(next.code)}
              disabled={!next}
              aria-label="下一檔"
              style={{ width: 26, height: 26, border: `1px solid ${WB.hair}`, background: 'transparent', cursor: next ? 'pointer' : 'not-allowed', color: next ? WB.ink : WB.inkLight, fontSize: 12, borderRadius: 2, fontFamily: 'inherit' }}
            >›</button>
          </div>
          <span style={{ fontSize: 10, color: WB.inkMute, letterSpacing: '0.16em', fontWeight: 500 }}>
            {String(curIdx + 1).padStart(2, '0')} / {String(visibleList.length).padStart(2, '0')}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => setShareMode(true)}
              aria-label="進入分享模式"
              title="分享 / 截圖"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 8px', border: `1px solid ${WB.hair}`, background: 'transparent', cursor: 'pointer', color: WB.ink, fontSize: 11, borderRadius: 2, fontFamily: 'inherit', letterSpacing: '0.04em' }}
            >
              <Camera size={12} /> 分享
            </button>
            <button
              onClick={() => setExpandedDecision(null)}
              aria-label="關閉"
              style={{ width: 26, height: 26, border: `1px solid ${WB.hair}`, background: 'transparent', cursor: 'pointer', color: WB.ink, fontSize: 14, borderRadius: 2, fontFamily: 'inherit' }}
            >×</button>
          </div>
        </div>
      )}

      {/* Share Mode 工具列 */}
      {shareMode && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderBottom: `1px solid ${WB.hair}`, background: WB.surfaceSoft,
        }}>
          <span style={{ fontSize: 10, color: WB.accent, letterSpacing: '0.20em', fontWeight: 600 }}>SHARE MODE</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleDownload}
              disabled={busy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 10px', border: `1px solid ${WB.ink}`, background: WB.ink, color: '#F4F1EC', cursor: busy ? 'wait' : 'pointer', fontSize: 11, borderRadius: 2, fontFamily: 'inherit', letterSpacing: '0.06em' }}
            >
              <Download size={12} /> 下載 PNG
            </button>
            <button
              onClick={() => copy(shareRef.current)}
              disabled={busy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 10px', border: `1px solid ${WB.hair}`, background: 'transparent', color: WB.ink, cursor: busy ? 'wait' : 'pointer', fontSize: 11, borderRadius: 2, fontFamily: 'inherit', letterSpacing: '0.06em' }}
            >
              <Copy size={12} /> 複製
            </button>
            <button
              onClick={() => setShareMode(false)}
              aria-label="退出分享模式"
              style={{ width: 28, height: 28, border: `1px solid ${WB.hair}`, background: 'transparent', cursor: 'pointer', color: WB.ink, fontSize: 14, borderRadius: 2, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <XIcon size={14} />
            </button>
          </div>
        </div>
      )}

      {/* 截圖目標容器 */}
      <div
        ref={shareRef}
        style={{
          padding: shareMode ? '24px 26px 18px' : '18px 22px 22px',
          background: WB.surface,
        }}
      >
        {/* ── 識別層 ── */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 11, color: WB.inkMute, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.06em' }}>{h.code}</span>
              <span style={{ fontSize: 20, fontWeight: 600, color: WB.ink, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name}</span>
            </div>
            {sparkArr.length >= 2 && (
              <div style={{ flexShrink: 0 }}>
                <Sparkline data={sparkArr} width={110} height={28} color={pctVal >= 0 ? WB.accent : '#8A857F'} opacity={0.9} />
              </div>
            )}
          </div>
          {(meta?.industry || meta?.strategy) && (
            <div style={microStyle}>
              {meta?.industry || ''}{meta?.industry && meta?.strategy ? ' · ' : ''}{meta?.strategy || ''}
            </div>
          )}
        </div>

        {/* ── 焦點層：PnL 大數 + DECISION 並排 ── */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 14,
          alignItems: 'stretch', marginBottom: 18, paddingBottom: 16,
          borderBottom: `1px solid ${WB.hair}`,
        }}>
          <div>
            <div style={labelStyle}>RETURN</div>
            <div style={{
              marginTop: 6, fontSize: 46, fontWeight: 600, color: pnlColor,
              letterSpacing: '-0.035em', lineHeight: 1, fontVariantNumeric: 'tabular-nums',
            }}>
              {pctVal >= 0 ? '+' : ''}{pctVal.toFixed(2)}<span style={{ fontSize: 18, opacity: 0.55, marginLeft: 2, fontWeight: 500 }}>%</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: WB.inkSub, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em' }}>
              {pnlVal >= 0 ? '+' : ''}{Math.round(pnlVal).toLocaleString()}
              {todayPct != null && (
                <span style={{ marginLeft: 10, color: WB.inkMute }}>
                  TODAY {todayPct >= 0 ? '+' : ''}{todayPct.toFixed(2)}%
                  {todayPnl != null && <> · {todayPnl >= 0 ? '+' : ''}{Math.round(todayPnl).toLocaleString()}</>}
                </span>
              )}
            </div>
          </div>
          <div style={{
            background: WB.ink, color: '#F4F1EC', padding: '12px 14px',
            borderRadius: 3, minWidth: 130, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          }}>
            <div style={{ fontSize: 9, color: 'rgba(244,241,236,0.55)', letterSpacing: '0.20em', fontWeight: 600 }}>DECISION</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: WB.accent, letterSpacing: '0.04em', margin: '6px 0 8px' }}>{actionLabel}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {[1, 2, 3, 4, 5].map((i) => (
                <span key={i} style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: i <= urgencyLevel ? WB.accent : 'transparent',
                  border: i <= urgencyLevel ? 'none' : '1px solid rgba(244,241,236,0.25)',
                }} />
              ))}
              <span style={{ marginLeft: 4, fontSize: 9, color: 'rgba(244,241,236,0.65)', letterSpacing: '0.14em', fontWeight: 600 }}>{urgencyLabel}</span>
            </div>
          </div>
        </div>

        {/* ── 脈絡層：成本/現價/數量、區間、佔比、目標 ── */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 14, rowGap: 12,
          marginBottom: 16,
        }}>
          <Block label="成本 → 現價" value={
            <>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{h.cost != null ? Number(h.cost).toFixed(2) : '—'}</span>
              <span style={{ color: WB.inkLight, margin: '0 6px' }}>→</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: WB.ink, fontWeight: 600 }}>{h.price != null ? Number(h.price).toFixed(2) : '—'}</span>
            </>
          } WB={WB} />
          <Block label="數量 · 市值" value={
            <>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{h.qty != null ? Number(h.qty).toLocaleString() : '—'}</span>
              <span style={{ color: WB.inkLight, margin: '0 6px' }}>·</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{valueNum ? Math.round(valueNum).toLocaleString() : '—'}</span>
            </>
          } WB={WB} />
          {(rangeLow != null && rangeHigh != null) && (
            <Block label="近 30D 區間" value={
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {rangeLow.toFixed(2)}<span style={{ color: WB.inkLight, margin: '0 6px' }}>—</span>{rangeHigh.toFixed(2)}
              </span>
            } WB={WB} />
          )}
          {weightPct != null && (
            <Block label="部位佔比" value={
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{weightPct.toFixed(1)}<span style={{ fontSize: 11, color: WB.inkLight, marginLeft: 2 }}>%</span></span>
            } WB={WB} />
          )}
        </div>

        {/* TARGET bar */}
        {tp && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={labelStyle}>TARGET</span>
              <span style={{ fontSize: 12, color: upside >= 0 ? WB.accent : WB.inkMute, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {tp.toLocaleString()} · {upside >= 0 ? '+' : ''}{upside?.toFixed(1)}%
              </span>
            </div>
            <div style={{ background: WB.hair, height: 3, width: '100%', overflow: 'hidden', borderRadius: 1 }}>
              <div style={{
                width: `${Math.min(Math.max((h.price / tp) * 100, 0), 100)}%`,
                height: '100%', background: WB.accent, opacity: 0.85,
              }} />
            </div>
          </div>
        )}

        {/* THESIS */}
        {thesisSentence && (
          <div style={{
            marginBottom: 14, padding: '12px 14px',
            border: `1px solid ${WB.hair}`, borderLeft: `3px solid ${WB.accent}`,
            background: WB.surfaceSoft, borderRadius: 2,
          }}>
            <div style={{ ...labelStyle, marginBottom: 6 }}>THESIS</div>
            <div style={{
              fontSize: 13, color: WB.ink, lineHeight: 1.65, fontWeight: 500,
              fontFamily: '"Source Serif 4", Georgia, serif',
            }}>
              「{thesisSentence}」
            </div>
            {dec && (
              <div style={{ marginTop: 8, fontSize: 10, color: WB.inkMute, letterSpacing: '0.04em' }}>
                論點 {dec.thesisState === 'broken' ? '破裂' : dec.thesisState === 'weakening' ? '弱化' : '完整'}
                {' · 信心 '}{dec.confidence === 'high' ? '高' : dec.confidence === 'medium' ? '中' : '低'}
                {' · 事件 '}{dec.openEventCount || 0}
              </div>
            )}
          </div>
        )}

        {/* NEXT EVENT */}
        {nextEvent && (
          <div style={{
            marginBottom: 14, padding: '12px 14px',
            border: `1px solid ${WB.hair}`, borderRadius: 2,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={labelStyle}>NEXT EVENT</span>
              {nextEvent.date && (
                <span style={{
                  fontSize: 9, color: WB.surface, background: WB.accent,
                  padding: '2px 7px', letterSpacing: '0.14em', fontWeight: 600, borderRadius: 2,
                }}>{nextEvent.date}</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: WB.inkSub, lineHeight: 1.6 }}>
              {nextEvent.summary || nextEvent.title || '(無摘要)'}
            </div>
          </div>
        )}

        {/* 浮水印 — Share Mode 才顯示 */}
        {shareMode && (
          <div style={{
            marginTop: 18, paddingTop: 12,
            borderTop: `1px solid ${WB.hair}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: 10, color: WB.inkMute, letterSpacing: '0.08em',
          }}>
            <span style={{ fontFamily: '"Source Serif 4", Georgia, serif', fontWeight: 600, color: WB.ink, letterSpacing: '0.02em' }}>
              legendflow<span style={{ color: WB.accent }}>.</span>tw
            </span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{stamp}</span>
          </div>
        )}
      </div>

      {/* 研究筆記入口 — Share Mode 隱藏 */}
      {!shareMode && (
        <div style={{ padding: '0 22px 22px' }}>
          <button
            onClick={() => openHoldingDrawer && openHoldingDrawer(h.code)}
            style={{
              width: '100%', padding: '12px', background: 'transparent',
              border: `1px solid ${WB.hair}`, borderRadius: 2,
              color: WB.inkSub, fontSize: 12, fontWeight: 500, cursor: 'pointer',
              letterSpacing: '0.08em', fontFamily: 'inherit',
            }}
            title="開啟研究筆記與決策紀錄"
          >研究筆記</button>
        </div>
      )}
    </div>
  );
}

function Block({ label, value, WB }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: WB.inkLight, letterSpacing: '0.18em', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: WB.inkSub, lineHeight: 1.4 }}>{value}</div>
    </div>
  );
}

const HoldingsDetailPanel = React.memo(HoldingsDetailPanelImpl);
export default HoldingsDetailPanel;
