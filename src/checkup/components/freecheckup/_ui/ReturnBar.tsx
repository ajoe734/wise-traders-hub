import { memo } from 'react';
import { clampReturnBar } from '@/checkup/lib/checkupFormat';

interface Props {
  pct: number;
  scale?: number;
  className?: string;
  ariaLabel?: string;
}

/**
 * Monocle 風報酬條：共用 ±40% 尺規；正向由中線向右 accent、負向向左 loss-bar；
 * |pct| > scale 拉滿並在右上顯示破表記號 `▸`。
 */
function ReturnBarImpl({ pct, scale = 40, className, ariaLabel }: Props) {
  const { ratio, over, sign } = clampReturnBar(pct, scale);
  const widthPct = (ratio * 50).toFixed(2) + '%';
  return (
    <div
      className={`cm-returnbar ${className || ''}`}
      role="img"
      aria-label={ariaLabel || `報酬率 ${pct.toFixed(2)}%`}
    >
      <span className="cm-returnbar__mid" aria-hidden />
      {sign > 0 && <span className="cm-returnbar__fill--pos" style={{ width: widthPct }} aria-hidden />}
      {sign < 0 && <span className="cm-returnbar__fill--neg" style={{ width: widthPct }} aria-hidden />}
      {over && (
        <span
          className="cm-returnbar__over"
          style={sign > 0 ? { right: -14 } : { left: -14, transform: 'scaleX(-1)' }}
          aria-hidden
        >▸</span>
      )}
    </div>
  );
}

export const ReturnBar = memo(ReturnBarImpl);
export default ReturnBar;
