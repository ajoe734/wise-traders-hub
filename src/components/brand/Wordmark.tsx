import { BRAND, BRAND_FONT_SERIF } from './tokens';

/**
 * legendflow 字標 (primary wordmark)。
 * 全小寫、無空格、letter-spacing −0.025em、字重 600。
 * 中間橘點是視覺裝飾（不是 ASCII），prop `tone` 控制主色。
 *
 * tone:
 *   - 'ink'  → 米色背景使用（預設）
 *   - 'bone' → 深色背景使用
 *   - 'cta'  → 主橘前景、米/白背景；橘點自動翻成墨黑
 */
export type WordmarkTone = 'ink' | 'bone' | 'cta';

export interface WordmarkProps {
  size?: number;
  tone?: WordmarkTone;
  className?: string;
  title?: string;
}

export function Wordmark({
  size = 15,
  tone = 'ink',
  className,
  title = 'legendflow',
}: WordmarkProps) {
  const color =
    tone === 'bone' ? BRAND.boneSoft : tone === 'cta' ? BRAND.cta : BRAND.ink;
  const dotColor = tone === 'cta' ? BRAND.ink : BRAND.cta;

  return (
    <span
      role="img"
      aria-label={title}
      className={className}
      style={{
        fontFamily: BRAND_FONT_SERIF,
        fontWeight: 600,
        fontSize: size,
        letterSpacing: '-0.025em',
        lineHeight: 1,
        color,
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      legend
      <span
        style={{
          color: dotColor,
          fontSize: '0.6em',
          verticalAlign: '0.3em',
          padding: '0 0.08em',
          fontWeight: 900,
        }}
      >
        ●
      </span>
      flow
    </span>
  );
}
