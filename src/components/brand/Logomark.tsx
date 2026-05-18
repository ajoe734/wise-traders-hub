import { BRAND, BRAND_FONT_SERIF } from './tokens';

/**
 * legendflow 標識方塊（l●f）。
 * 用於 top bar、極小空間、favicon 風格出現。
 * 規範：墨黑底圓角方塊（borderRadius = size * 0.25）、米白字、主橘點。
 */
export interface LogomarkProps {
  size?: number;
  className?: string;
  title?: string;
}

export function Logomark({ size = 28, className, title = 'legendflow' }: LogomarkProps) {
  return (
    <div
      role="img"
      aria-label={title}
      className={className}
      style={{
        width: size,
        height: size,
        background: BRAND.ink,
        color: BRAND.boneSoft,
        borderRadius: size * 0.25,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: BRAND_FONT_SERIF,
        fontWeight: 700,
        fontSize: size * 0.5,
        letterSpacing: '-0.04em',
        lineHeight: 1,
        userSelect: 'none',
      }}
    >
      l
      <span style={{ color: BRAND.cta, fontSize: '0.6em', padding: '0 1px' }}>●</span>
      f
    </div>
  );
}
