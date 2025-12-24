import React from "react";
import vsBrush from "@/assets/vs-clean-noseal.png";

type VsBrushMarkProps = {
  className?: string;
  title?: string;
  style?: React.CSSProperties;
};

/**
 * Renders the VS brush mark with a clean background removal using an SVG mask.
 * This avoids the "white box" and keeps edges crisp.
 */
export function VsBrushMark({ className, title = "VS", style }: VsBrushMarkProps) {
  const id = React.useId();

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      style={style}
      role="img"
      aria-label={title}
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <filter id={`${id}-mask`} colorInterpolationFilters="sRGB">
          {/* invert: white bg -> black (transparent), black ink -> white (opaque) */}
          <feComponentTransfer>
            <feFuncR type="table" tableValues="1 0" />
            <feFuncG type="table" tableValues="1 0" />
            <feFuncB type="table" tableValues="1 0" />
          </feComponentTransfer>
          {/* make it luminance */}
          <feColorMatrix type="saturate" values="0" />
          {/* boost contrast a bit to reduce dirty halo */}
          <feComponentTransfer>
            <feFuncR type="linear" slope="2.2" intercept="-0.6" />
            <feFuncG type="linear" slope="2.2" intercept="-0.6" />
            <feFuncB type="linear" slope="2.2" intercept="-0.6" />
          </feComponentTransfer>
        </filter>

        <mask id={`${id}-alpha`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <image
            href={vsBrush}
            x="0"
            y="0"
            width="100"
            height="100"
            preserveAspectRatio="xMidYMid meet"
            filter={`url(#${id}-mask)`}
          />
        </mask>
      </defs>

      <rect x="0" y="0" width="100" height="100" fill="black" mask={`url(#${id}-alpha)`} />
    </svg>
  );
}

