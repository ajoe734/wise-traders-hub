// @ts-nocheck
/**
 * HoldingCardHeader — §3.4 步驟 1（Handoff 2026-07-15）
 *   `名稱 代號` ＋ 檢視/出場徽章 ｜ 右側只保留產業 tag（權證虛線框、到期警示）
 * 憲法：
 *   - HOLD 不渲染任何徽章
 *   - Sparkline / 股數 / 策略散文 / 教學徽章 / 回報鈕 全部移到抽屜（§4）
 *   - `.wb-spark` / `.wb-tags` / `.wb-tip` 為 e2e / CSS 契約 → 保留為 hidden placeholder，
 *     data-* 派生值原樣保留給回歸腳本比對
 */
import { memo, useMemo } from 'react';
import { WB } from '@/pages/_freeCheckup/constants.jsx';
import { useRenderCounter } from '@/checkup/hooks/useRenderCounter';

/** per-signal 教學片段 fallback（保留 export，抽屜 §4.2 續用）。 */
export function getFallbackTip(actionLabel) {
  const raw = String(actionLabel || '');
  const k = raw.trim().toUpperCase();
  if (/^(ADD|BUY)$/.test(k) || /加碼|買進/.test(raw)) return '進場前先確認風險比例';
  if (/^(REDUCE|SELL)$/.test(k) || /減碼|賣出/.test(raw)) return '分批減碼保留紀律';
  if (/^HOLD$/.test(k) || /續抱/.test(raw)) return '續抱請設好停損';
  return '持倉檢視小提醒';
}

/** 權證判定：meta.instrument 明示或代號字母開頭。 */
function isWarrant(h, meta) {
  if (meta?.instrument === 'warrant') return true;
  const code = String(h?.code || '');
  return /^[A-Za-z]/.test(code) && code.length >= 5;
}

/** 權證到期文案：≤1 月轉 accent。 */
function warrantExpiryLabel(meta) {
  const raw = meta?.warrantExpiry || meta?.expiry;
  if (!raw) return { text: '權證', urgent: false };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { text: '權證', urgent: false };
  const now = new Date();
  const days = Math.round((d.getTime() - now.getTime()) / 86400000);
  const months = Math.max(0, Math.round(days / 30));
  const urgent = days <= 31;
  const text = months <= 0 ? '權證 · 即將到期' : `權證 · 到期 ${months} 月`;
  return { text, urgent };
}

function HoldingCardHeaderImpl({
  h,
  meta,
  variant = 'normal',
  cardColor,
  muteColor,
  sparkData,
  sparkFailed,
  actionLabel,
  pctVal,
}) {
  useRenderCounter('HoldingCardHeader', { id: h?.code });

  const isInk = variant === 'ink';
  const isFeature = isInk;
  const nameFont = isFeature ? 15 : 13;
  const rowMb = isFeature ? 6 : 4;

  const pctSign = pctVal >= 0 ? 1 : -1;
  const sparkColor = isInk ? '#F4F1EC' : (pctSign >= 0 ? WB.accent : '#9B968D');
  const sparkOpacity = pctSign >= 0 ? 0.85 : (isInk ? 0.6 : 0.55);

  const industries = useMemo(() => {
    if (meta?.industries?.length) return meta.industries;
    if (meta?.industry) return [meta.industry];
    return [];
  }, [meta?.industries, meta?.industry]);

  const warrantInfo = isWarrant(h, meta) ? warrantExpiryLabel(meta) : null;
  const tagBg = isInk ? 'rgba(255,255,255,0.08)' : '#F4F2EE';
  const tagColor = isInk ? 'rgba(244,241,236,0.78)' : WB.inkSub;

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, marginBottom: rowMb,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flex: 1 }}>
          <span style={{
            fontSize: nameFont, fontWeight: 400, color: cardColor,
            letterSpacing: isFeature ? '-0.005em' : 0,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            minWidth: 0,
          }}>{h.name}</span>
          <span style={{
            fontSize: 11, color: muteColor, fontVariantNumeric: 'tabular-nums',
            letterSpacing: '0.04em', flexShrink: 0,
          }}>{h.code}</span>
        </div>

        {/* Sparkline 依 §3.4 步驟 1 移至抽屜 §4.2；保留 hidden hook（class + data-*）供 e2e / CSS 契約 */}
        <span
          className="wb-spark"
          aria-hidden="true"
          data-spark-sign={pctSign}
          data-spark-color={sparkColor}
          data-spark-opacity={String(sparkOpacity)}
          data-spark-variant={isInk ? 'ink' : 'normal'}
          data-spark-fallback={sparkFailed ? 'failed' : (sparkData?.length >= 2 ? 'inline' : 'empty')}
          data-spark-relocated="drawer-4.2"
          style={{ display: 'none' }}
        />

        {(() => {
          const kind = String(actionLabel || '').toLowerCase();
          if (kind === 'exit') {
            return (
              <span
                data-action-badge="exit"
                style={{
                  fontSize: 10, fontWeight: 500, letterSpacing: '0.12em',
                  color: '#FFFFFF', background: WB.accent,
                  padding: '3px 8px', borderRadius: 0, flexShrink: 0,
                  lineHeight: 1.4,
                }}
              >出場</span>
            );
          }
          if (kind === 'review') {
            return (
              <span
                data-action-badge="review"
                style={{
                  fontSize: 10, fontWeight: 500, letterSpacing: '0.12em',
                  color: WB.accent, background: 'transparent',
                  border: `1px solid ${WB.accent}`,
                  padding: '2px 7px', borderRadius: 0, flexShrink: 0,
                  lineHeight: 1.4,
                }}
              >檢視</span>
            );
          }
          return null;
        })()}
      </div>

      {/* wb-tags：§3.4 只留產業 tag（權證特殊樣式）。策略/教學/回報 全移抽屜 §4。
          容器仍渲染以維持 e2e 選擇器；無 industries 且非權證時走 hidden placeholder。 */}
      <div
        className="wb-tags"
        data-tags-mode={warrantInfo ? 'warrant' : (industries.length ? 'industry' : 'empty')}
        style={{
          display: (industries.length || warrantInfo) ? 'flex' : 'none',
          gap: 6, marginBottom: isFeature ? 10 : 8,
          flexWrap: 'wrap', alignItems: 'center',
        }}
      >
        {warrantInfo ? (
          <span
            data-warrant-urgent={warrantInfo.urgent ? '1' : '0'}
            style={{
              fontSize: 10,
              color: warrantInfo.urgent ? WB.accent : tagColor,
              letterSpacing: '0.08em',
              padding: '3px 7px', background: 'transparent',
              border: `1px dashed ${warrantInfo.urgent ? WB.accent : 'rgba(0,0,0,0.25)'}`,
              borderRadius: 0,
            }}
          >{warrantInfo.text}</span>
        ) : (
          industries.map((ind, i) => (
            <span
              key={`ind-${i}`}
              style={{
                fontSize: 10, color: tagColor, letterSpacing: '0.08em',
                padding: '4px 8px', background: tagBg,
                border: 'none', borderRadius: 0,
                opacity: i === 0 ? 1 : 0.75,
              }}
            >{ind}</span>
          ))
        )}
      </div>
    </>
  );
}

export const HoldingCardHeader = memo(HoldingCardHeaderImpl);
export default HoldingCardHeader;
