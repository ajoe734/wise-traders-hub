import React from "react";
import vsBrush from "@/assets/vs-clean.png";

type VsBrushMarkProps = {
  className?: string;
  title?: string;
};

/**
 * Renders the VS brush mark with background removed using mix-blend-mode
 * for clean, crisp edges without blurring
 */
export function VsBrushMark({ className, title = "VS" }: VsBrushMarkProps) {
  return (
    <div 
      className={className}
      role="img"
      aria-label={title}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <img 
        src={vsBrush} 
        alt=""
        className="w-full h-full object-contain"
        style={{ 
          mixBlendMode: 'multiply',
          filter: 'contrast(1.5)'
        }}
        aria-hidden="true"
      />
    </div>
  );
}
