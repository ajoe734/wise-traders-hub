import React from "react";
import vsBrush from "@/assets/vs-brush.png";

type VsBrushMarkProps = {
  className?: string;
  title?: string;
};

/**
 * Renders the VS brush mark with background removed (true transparency)
 * by using an SVG mask that inverts the source image.
 */
export function VsBrushMark({ className, title = "VS" }: VsBrushMarkProps) {
  const id = React.useId();

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label={title}
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <filter id={`${id}-invert`}>
          <feComponentTransfer>
            <feFuncR type="table" tableValues="1 0" />
            <feFuncG type="table" tableValues="1 0" />
            <feFuncB type="table" tableValues="1 0" />
          </feComponentTransfer>
        </filter>

        <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <image
            href={vsBrush}
            x="0"
            y="0"
            width="100"
            height="100"
            preserveAspectRatio="xMidYMid meet"
            filter={`url(#${id}-invert)`}
          />
        </mask>
      </defs>

      {/* Black ink mark with transparent background */}
      <rect x="0" y="0" width="100" height="100" fill="black" mask={`url(#${id}-mask)`} />
    </svg>
  );
}
