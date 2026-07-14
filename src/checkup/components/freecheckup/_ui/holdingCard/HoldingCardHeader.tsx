// @ts-nocheck
/**
 * HoldingCardHeader — 第 1 層：代號 · 名稱 · 股數 · Sparkline · Action badge + 產業/策略 tags
 * 對外憲法：保留 `.wb-spark` / `.wb-tags` class name（既有 CSS 與截圖回歸依賴）。
 */
import { memo } from 'react';
import { WB, Sparkline } from '@/pages/_freeCheckup/constants.jsx';

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
  const isInk = variant === 'ink';
  const isFeature = variant === 'ink';
  const nameFont = isFeature ? 15 : 13;
  const rowMb = isFeature ? 6 : 4;
  const tagBg = isInk ? 'rgba(255,255,255,0.08)' : '#F4F2EE';
  const tagColor = isInk ? 'rgba(244,241,236,0.78)' : WB.inkSub;
  const reportColor = isInk ? 'rgba(244,241,236,0.55)' : '#B0A99C';
  const reportBorder = isInk ? 'rgba(244,241,236,0.25)' : 'rgba(0,0,0,0.15)';
  const sparkColor = isInk ? '#F4F1EC' : (pctVal >= 0 ? WB.accent : '#9B968D');
  const sparkOpacity = pctVal >= 0 ? 0.85 : (isInk ? 0.6 : 0.55);

  const industries = meta?.industries?.length
    ? meta.industries
    : (meta?.industry ? [meta.industry] : []);
  const hasTags = industries.length > 0 || meta?.strategy || onReportMeta;

  const openReportMeta = (e) => {
    e.stopPropagation();
    if (typeof onReportMeta === 'function') onReportMeta(h);
  };
  const onReportKeyDown = (e) => {
    // 攔截 Enter/Space，避免同時觸發外層 button 的 onSelect，
    // 並防止 Shift+Enter 冒泡開啟決策抽屜。
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      e.stopPropagation();
      if (typeof onReportMeta === 'function') onReportMeta(h);
    }
  };

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
          <span className="wb-spark" aria-hidden="true" style={{ display: 'inline-flex', flexShrink: 0 }}>
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
