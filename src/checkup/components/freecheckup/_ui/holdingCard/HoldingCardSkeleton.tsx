// @ts-nocheck
/**
 * HoldingCardSkeleton — HoldingCard 四層骨架屏。
 *
 * 目的：在資料尚未載入（!inView 或 h._loading）時提供尺寸完全一致的
 * 佔位版式，確保 320 / 340 / 375 / 414 四斷點不跳動。
 *
 * 對齊真實四層版式高度：
 *   Layer 1 Header       ~72px（代號 + 名稱兩行 + tag 帶）
 *   Layer 2 Return       ~64px（大字 ROI）
 *   Layer 3 PriceTrack   ~48px（成本→現價 + 決策摘要 2 行）
 *   Layer 4 Footer       ~44px（TODAY / VALUE 底部帶）
 *   合計 + gap ≈ MIN_H(320)
 *
 * 使用既有 `@keyframes shimmer`（src/index.css:756）。
 */
import { WB } from '@/pages/_freeCheckup/constants.jsx';

const barBase = (isInk) => ({
  background: isInk ? 'rgba(244,241,236,0.10)' : 'rgba(41,37,32,0.06)',
  backgroundImage: isInk
    ? 'linear-gradient(90deg, rgba(244,241,236,0) 0%, rgba(244,241,236,0.18) 50%, rgba(244,241,236,0) 100%)'
    : 'linear-gradient(90deg, rgba(41,37,32,0) 0%, rgba(41,37,32,0.10) 50%, rgba(41,37,32,0) 100%)',
  backgroundSize: '200% 100%',
  animation: 'shimmer 1.4s linear infinite',
  borderRadius: 0,
});

export default function HoldingCardSkeleton({ variant = 'normal' }) {
  const isInk = variant === 'ink';
  const hairColor = isInk ? 'rgba(244,241,236,0.14)' : WB.hair;
  const b = barBase(isInk);

  return (
    <div
      data-testid="holding-card-skeleton"
      aria-hidden="true"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        gap: 14,
        width: '100%',
      }}
    >
      {/* Layer 1 · Header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
            <div style={{ ...b, height: 14, width: '38%' }} />
            <div style={{ ...b, height: 18, width: '72%' }} />
          </div>
          {/* Sparkline 佔位 */}
          <div style={{ ...b, height: 28, width: 84, flexShrink: 0 }} />
        </div>
        {/* Tag 帶 */}
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ ...b, height: 16, width: 56 }} />
          <div style={{ ...b, height: 16, width: 44 }} />
        </div>
      </div>

      {/* Layer 2 · Return（大字 ROI） */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ ...b, height: 40, width: '55%' }} />
        <div style={{ ...b, height: 12, width: '30%' }} />
      </div>

      {/* Layer 3 · Price Track */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 'auto' }}>
        <div style={{ ...b, height: 12, width: '65%' }} />
        <div style={{ ...b, height: 12, width: '88%' }} />
      </div>

      {/* Layer 4 · Footer */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          paddingTop: 12,
          borderTop: `1px solid ${hairColor}`,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ ...b, height: 10, width: 40 }} />
          <div style={{ ...b, height: 14, width: '70%' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
          <div style={{ ...b, height: 10, width: 40 }} />
          <div style={{ ...b, height: 14, width: '70%' }} />
        </div>
      </div>
    </div>
  );
}
