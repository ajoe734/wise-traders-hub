import React from 'react';

/**
 * HoldingsActionPriority — Holdings tab 頂部 Action Priority 單行文字流
 * 抽自 FreeCheckup.jsx L3684-L3768，純展示元件，無內部 state。
 *
 * B-P5 (holdings audit 2026-05)：
 *   parent 預先組裝 items（含 tag/desc），元件不再接 decisionsMap/STOCK_META 全表。
 *   舊呼叫（傳 holdings + decisionsMap + stockMeta）仍 fallback 支援。
 */
function HoldingsActionPriorityImpl({
  items = [],
  decisionsMap,
  stockMeta,
  WB,
  onPick,
}) {
  if (!items || items.length === 0) {
    return (
      <div style={{
        marginBottom: 18, padding: '6px 2px',
        fontSize: 11, color: WB.inkLight, fontWeight: 400, letterSpacing: '0.04em',
      }}>
        No pending actions · Portfolio in good standing
      </div>
    );
  }
  return (
    <div style={{
      marginBottom: 18, padding: '8px 0 12px',
      borderBottom: `1px solid ${WB.hair}`,
      display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap',
    }}>
      <span style={{
        fontSize: 9.5, color: WB.inkMute, letterSpacing: '0.22em',
        textTransform: 'uppercase', fontWeight: 500,
        display: 'inline-flex', alignItems: 'baseline', gap: 8, flexShrink: 0,
      }}>
        Action Priority
        <span style={{
          display: 'inline-block', width: 4, height: 4, borderRadius: '50%',
          background: WB.accent, transform: 'translateY(-1px)',
        }} />
      </span>
      <span style={{
        display: 'flex', flexWrap: 'wrap',
        gap: '14px 28px', flex: 1,
      }}>
        {items.map((it) => {
          // B-P5: items 已含 tag/desc/pct；舊呼叫 fallback 至 decisionsMap/stockMeta
          let tag = it.tag;
          let desc = it.desc;
          if (!tag || !desc) {
            const dec = decisionsMap ? decisionsMap[it.code] : null;
            tag = tag || (dec?.actionType === 'exit' ? 'EXIT'
              : dec?.actionType === 'review' ? 'REVIEW' : 'WATCH');
            desc = desc || (dec?.actionText
              ? (dec.actionText.length > 32 ? dec.actionText.slice(0, 30) + '…' : dec.actionText)
              : (stockMeta?.[it.code]?.strategy || '持續監控'));
          }
          const pct = it.pct ?? 0;
          return (
            <button
              key={it.code}
              onClick={() => onPick && onPick(it.code)}
              style={{
                background: 'transparent', border: 'none', padding: 0,
                fontFamily: 'inherit', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                gap: 3, textAlign: 'left',
              }}
            >
              <span style={{
                display: 'inline-flex', alignItems: 'baseline', gap: 6,
                fontSize: 12, color: WB.ink, fontWeight: 500, letterSpacing: '0.01em',
              }}>
                <span style={{
                  fontSize: 9, color: WB.accent, letterSpacing: '0.16em',
                  fontWeight: 500,
                }}>{tag}</span>
                <span>{it.code}</span>
                <span style={{ color: WB.inkSub, fontWeight: 400 }}>{it.name}</span>
                <span style={{
                  color: WB.inkLight, fontSize: 11, fontVariantNumeric: 'tabular-nums', fontWeight: 400,
                }}>
                  {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                </span>
              </span>
              <span style={{
                fontSize: 11, color: WB.inkMute, letterSpacing: '0.01em',
                lineHeight: 1.5,
              }}>{desc}</span>
            </button>
          );
        })}
      </span>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, borderRadius: '50%',
        border: `1px solid ${WB.hair}`, color: WB.inkMute, fontSize: 12,
        flexShrink: 0,
      }}>→</span>
    </div>
  );
}

const HoldingsActionPriority = React.memo(HoldingsActionPriorityImpl);
export default HoldingsActionPriority;
