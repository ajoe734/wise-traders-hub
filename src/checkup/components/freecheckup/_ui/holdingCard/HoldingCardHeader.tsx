// @ts-nocheck
/**
 * HoldingCardHeader — 第 1 層：代號 · 名稱 · 股數 · Sparkline · Action badge + 產業/策略 tags + 教學徽章
 * 對外憲法：保留 `.wb-spark` / `.wb-tags` / `.wb-tip` class name（既有 CSS 與截圖回歸依賴）。
 */
import { memo, useMemo, useCallback } from 'react';
import { WB, Sparkline } from '@/pages/_freeCheckup/constants.jsx';
import { useRenderCounter } from '@/checkup/hooks/useRenderCounter';

/**
 * per-signal 教學片段 fallback：依 actionLabel 分流。
 * 支援英文 (ADD/BUY/REDUCE/SELL/HOLD) 與繁中 (加碼/買進/減碼/賣出/續抱)。
 */
export function getFallbackTip(actionLabel) {
  const raw = String(actionLabel || '');
  const k = raw.trim().toUpperCase();
  if (/^(ADD|BUY)$/.test(k) || /加碼|買進/.test(raw)) return '進場前先確認風險比例';
  if (/^(REDUCE|SELL)$/.test(k) || /減碼|賣出/.test(raw)) return '分批減碼保留紀律';
  if (/^HOLD$/.test(k) || /續抱/.test(raw)) return '續抱請設好停損';
  return '持倉檢視小提醒';
}


function HoldingCardHeaderImpl({
  h,
  meta,
  onReportMeta,
  variant = 'normal',
  cardColor,
  muteColor,
  sparkData,
  sparkFailed,
  actionLabel,
  pctVal,
}) {
  // dev/test：追蹤本卡標頭 render 次數；生產環境 no-op
  useRenderCounter('HoldingCardHeader', { id: h?.code });

  const isInk = variant === 'ink';
  const isFeature = isInk; // 語意等價保留（原本重複判定 variant === 'ink'）
  const nameFont = isFeature ? 15 : 13;
  const rowMb = isFeature ? 6 : 4;

  // ── Palette：只依賴 isInk，缓存以避免每次 render 建立新字串引用 ──
  const palette = useMemo(() => ({
    tagBg: isInk ? 'rgba(255,255,255,0.08)' : '#F4F2EE',
    tagColor: isInk ? 'rgba(244,241,236,0.78)' : WB.inkSub,
    reportColor: isInk ? 'rgba(244,241,236,0.55)' : '#B0A99C',
    reportBorder: isInk ? 'rgba(244,241,236,0.25)' : 'rgba(0,0,0,0.15)',
  }), [isInk]);
  const { tagBg, tagColor, reportColor, reportBorder } = palette;

  // ── Sparkline 派生：依 pctVal 正負 + isInk 決定顏色/透明度 ──
  // 用 sign 而非 raw pctVal，避免每次 tick 都改變 memo key
  const pctSign = pctVal >= 0 ? 1 : -1;
  const sparkColor = useMemo(
    () => (isInk ? '#F4F1EC' : (pctSign >= 0 ? WB.accent : '#9B968D')),
    [isInk, pctSign],
  );
  const sparkOpacity = useMemo(
    () => (pctSign >= 0 ? 0.85 : (isInk ? 0.6 : 0.55)),
    [isInk, pctSign],
  );

  // industries 陣列穩定引用：只在 meta.industries / meta.industry 改變時重算
  const industries = useMemo(() => {
    if (meta?.industries?.length) return meta.industries;
    if (meta?.industry) return [meta.industry];
    return [];
  }, [meta?.industries, meta?.industry]);

  // per-signal 教學片段（tipInfo）：優先 meta.tip / meta.tips[0]，缺則依 actionLabel fallback。
  // deps 僅含 meta.tip / meta.tips / actionLabel，避免 pctVal tick 每次觸發重算。
  const tipInfo = useMemo(() => {
    const list = Array.isArray(meta?.tips)
      ? meta.tips.filter((s) => typeof s === 'string' && s.trim())
      : [];
    const single = typeof meta?.tip === 'string' && meta.tip.trim() ? meta.tip.trim() : '';
    const primary = single || list[0] || '';
    const source = primary ? 'meta' : 'fallback';
    const text = primary || getFallbackTip(actionLabel);
    const extra = single ? list : list.slice(1);
    return { text, source, extra };
  }, [meta?.tip, meta?.tips, actionLabel]);

  const hasVisibleTags = industries.length > 0 || !!meta?.strategy || !!onReportMeta;


  // 事件 handler 缓存：Sparkline 為 memo 元件，穩定引用避免子樹重渲染
  const openReportMeta = useCallback((e) => {
    e.stopPropagation();
    if (typeof onReportMeta === 'function') onReportMeta(h);
  }, [onReportMeta, h]);
  const onReportKeyDown = useCallback((e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      e.stopPropagation();
      if (typeof onReportMeta === 'function') onReportMeta(h);
    }
  }, [onReportMeta, h]);


  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, marginBottom: rowMb,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flex: 1 }}>
          <span style={{
            fontSize: 11, color: muteColor, fontVariantNumeric: 'tabular-nums',
            letterSpacing: '0.04em', flexShrink: 0,
          }}>{h.code}</span>
          <span style={{
            fontSize: nameFont, fontWeight: 400, color: cardColor,
            letterSpacing: isFeature ? '-0.005em' : 0,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{h.name}</span>
          {h.qty != null && (
            <span style={{
              fontSize: 10, color: muteColor, fontVariantNumeric: 'tabular-nums',
              letterSpacing: '0.04em', flexShrink: 0,
            }}>× {Number(h.qty).toLocaleString()}{h.unit ? ` ${h.unit}` : ' 股'}</span>
          )}
        </div>
        {sparkData.length >= 2 ? (
          <span
            className="wb-spark"
            aria-hidden="true"
            style={{ display: 'inline-flex', flexShrink: 0 }}
            // e2e hook：即使 demo 種子沒實際歷史價，仍可從屬性驗證派生值一致性
            data-spark-sign={pctSign}
            data-spark-color={sparkColor}
            data-spark-opacity={String(sparkOpacity)}
            data-spark-variant={isInk ? 'ink' : 'normal'}
          >
            <Sparkline data={sparkData} width={60} height={20} color={sparkColor} opacity={sparkOpacity} />
          </span>
        ) : (
          <span
            className="wb-spark"
            aria-hidden="true"
            title={sparkFailed ? '歷史價尚未同步，稍後重試' : undefined}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 60, height: 20, fontSize: 11, color: muteColor,
              opacity: 0.4, flexShrink: 0, letterSpacing: '0.3em',
            }}
            data-spark-sign={pctSign}
            data-spark-color={sparkColor}
            data-spark-opacity={String(sparkOpacity)}
            data-spark-variant={isInk ? 'ink' : 'normal'}
            data-spark-fallback={sparkFailed ? 'failed' : 'empty'}
          >{sparkFailed ? '~' : '———'}</span>
        )}
        <span aria-hidden="true" style={{
          fontSize: 9, fontWeight: 500, letterSpacing: '0.20em',
          color: WB.accent, textTransform: 'uppercase', flexShrink: 0,
        }}>{actionLabel}</span>
      </div>

      {hasTags && (
        <div
          className="wb-tags"
          style={{
            display: 'flex', gap: 6, marginBottom: isFeature ? 10 : 8,
            flexWrap: 'wrap', alignItems: 'center',
          }}
        >
          {industries.map((ind, i) => (
            <span
              key={`ind-${i}`}
              style={{
                fontSize: 10, color: tagColor, letterSpacing: '0.08em',
                padding: '4px 8px', background: tagBg,
                border: 'none', borderRadius: 0,
                opacity: i === 0 ? 1 : 0.75,
              }}
            >{ind}</span>
          ))}
          {meta?.strategy && (
            <span style={{
              fontSize: 10, color: tagColor, letterSpacing: '0.08em',
              padding: '4px 8px', background: tagBg,
              border: 'none', borderRadius: 0,
            }}>{meta.strategy}</span>
          )}
          {onReportMeta && (
            // 為避免 <button> 巢狀（HTML 規範禁止），使用 role=button 的 span
            <span
              role="button"
              tabIndex={0}
              onClick={openReportMeta}
              onKeyDown={onReportKeyDown}
              title="回報分類錯誤"
              aria-label={`回報 ${h.code} 分類錯誤`}
              style={{
                fontSize: 10, color: reportColor, letterSpacing: '0.08em',
                padding: '4px 6px', background: 'transparent',
                border: `1px dashed ${reportBorder}`, borderRadius: 0,
                cursor: 'pointer', marginLeft: 'auto',
                userSelect: 'none', display: 'inline-block',
              }}
            >回報</span>
          )}
        </div>
      )}
    </>
  );
}

export const HoldingCardHeader = memo(HoldingCardHeaderImpl);
export default HoldingCardHeader;
