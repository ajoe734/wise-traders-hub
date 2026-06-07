/**
 * InkFade — 江湖統一的「紙↔墨」過渡帶。
 *
 * 取代任何 `linear-gradient(to bottom, black, white)` 水平黑邊。
 * 內部三層：
 *  1. 主背景連續 radial gradient（紙→暈染→墨，非水平 bar）
 *  2. 左右兩團 blur 28px 的紙團 / 墨團，邊緣不規則
 *  3. SVG fractalNoise 紙紋 mix-blend-overlay，全段帶紙質感
 *
 * 套用 4 個首頁淺↔深交界，元件本身負責高度，外層不要再 padding。
 */
import React from 'react';

type Direction = 'paper-to-ink' | 'ink-to-paper';

interface InkFadeProps {
  direction: Direction;
  height?: number;          // 預設 140px
  paperColor?: string;      // 預設 #EFE7D6
  inkColor?: string;        // 預設 #0E0C0A
  className?: string;
}

const NOISE_BG =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.06  0 0 0 0 0.05  0 0 0 0 0.04  0 0 0 0.5 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

// 預設使用 jh-* 設計 token。傳入硬編碼 hex 視為例外。
const DEFAULT_PAPER = 'hsl(var(--jh-paper))';
const DEFAULT_INK = 'hsl(var(--jh-ink))';

export function InkFade({
  direction,
  height = 140,
  paperColor = DEFAULT_PAPER,
  inkColor = DEFAULT_INK,
  className,
}: InkFadeProps) {
  const isPaperToInk = direction === 'paper-to-ink';

  // radial 中心 y：paper-to-ink 從頂端紙面 → 底端墨；ink-to-paper 反之
  const mainGradient = isPaperToInk
    ? `radial-gradient(ellipse 130% 110% at 50% -20%, ${paperColor} 0%, ${paperColor} 24%, rgba(120,90,60,0.55) 52%, rgba(40,30,22,0.55) 74%, ${inkColor} 100%)`
    : `radial-gradient(ellipse 130% 110% at 50% 120%, ${paperColor} 0%, ${paperColor} 24%, rgba(120,90,60,0.55) 52%, rgba(40,30,22,0.55) 74%, ${inkColor} 100%)`;

  // 上下底色：避免任何縫隙
  const bgColor = isPaperToInk ? inkColor : paperColor;

  // 紙團 / 墨團方向
  const cloudY = isPaperToInk ? '-30px' : 'auto';
  const cloudBottom = isPaperToInk ? 'auto' : '-30px';
  const cloudColor = isPaperToInk
    ? `radial-gradient(ellipse 60% 55% at 50% 30%, ${paperColor} 0%, rgba(239,231,214,0.55) 30%, rgba(120,90,60,0.22) 65%, transparent 85%)`
    : `radial-gradient(ellipse 60% 55% at 50% 70%, ${paperColor} 0%, rgba(239,231,214,0.55) 30%, rgba(120,90,60,0.22) 65%, transparent 85%)`;

  const inkBlobY = isPaperToInk ? height * 0.55 : -height * 0.25;
  const inkBlobBg = `radial-gradient(ellipse 55% 60% at 50% ${isPaperToInk ? '70%' : '30%'}, rgba(14,12,10,0.78), rgba(14,12,10,0.45) 45%, transparent 78%)`;

  return (
    <div
      aria-hidden="true"
      className={`relative w-full overflow-hidden ${className ?? ''}`}
      style={{ height, backgroundColor: bgColor }}
    >
      {/* 主連續暈染 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: mainGradient }}
      />
      {/* 左側雲團 */}
      <div
        className="absolute pointer-events-none"
        style={{
          left: '-12%',
          top: cloudY,
          bottom: cloudBottom,
          width: '70%',
          height: height * 1.5,
          background: cloudColor,
          filter: 'blur(22px)',
        }}
      />
      {/* 右側雲團 */}
      <div
        className="absolute pointer-events-none"
        style={{
          right: '-12%',
          top: cloudY,
          bottom: cloudBottom,
          width: '70%',
          height: height * 1.5,
          background: cloudColor,
          filter: 'blur(22px)',
        }}
      />
      {/* 對向墨團（向紙面滲入或從墨面浮起） */}
      <div
        className="absolute inset-x-0 pointer-events-none"
        style={{
          top: inkBlobY,
          height: height * 0.9,
          background: inkBlobBg,
          filter: 'blur(26px)',
        }}
      />
      {/* 紙紋雜訊：全段帶紙質感 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: NOISE_BG,
          mixBlendMode: 'overlay',
          opacity: 0.18,
        }}
      />
    </div>
  );
}

export default InkFade;
