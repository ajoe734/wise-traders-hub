import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface StatCardProps {
  number?: string;
  label: string;
  value: string | number;
  sublabel?: string;
  icon?: ReactNode;
  theme?: 'signals' | 'learning' | 'success' | 'destructive' | 'default';
  variant?: 'default' | 'compact' | 'large';
  className?: string;
  glowing?: boolean;
}

export function StatCard({ 
  number,
  label, 
  value, 
  sublabel,
  icon,
  theme = 'default',
  variant = 'default',
  className,
  glowing = false,
}: StatCardProps) {
  const themeClasses = {
    signals: "border-signals-accent/20 bg-gradient-to-br from-signals-accent/5 to-transparent",
    learning: "border-learning-accent/20 bg-gradient-to-br from-learning-accent/5 to-transparent",
    success: "border-success/20 bg-gradient-to-br from-success/5 to-transparent",
    destructive: "border-destructive/20 bg-gradient-to-br from-destructive/5 to-transparent",
    default: "border-border bg-card",
  };

  const valueColors = {
    signals: "text-signals-accent",
    learning: "text-learning-accent",
    success: "text-success",
    destructive: "text-destructive",
    default: "text-foreground",
  };

  const glowClasses = glowing ? cn(
    "animate-pulse",
    theme === 'signals' && "shadow-[0_0_20px_-5px_hsl(var(--signals-accent)/0.4)]",
    theme === 'learning' && "shadow-[0_0_20px_-5px_hsl(var(--learning-accent)/0.4)]",
    theme === 'success' && "shadow-[0_0_20px_-5px_hsl(var(--success)/0.4)]",
    theme === 'destructive' && "shadow-[0_0_20px_-5px_hsl(var(--destructive)/0.4)]"
  ) : "";

  const sizeClasses = {
    compact: "p-3",
    default: "p-4",
    large: "p-5",
  };

  const valueSizes = {
    compact: "text-xl",
    default: "text-2xl",
    large: "text-3xl",
  };

  return (
    <div 
      className={cn(
        "relative rounded-xl border overflow-hidden transition-all",
        themeClasses[theme],
        sizeClasses[variant],
        glowClasses,
        className
      )}
    >
      {/* Large decorative number */}
      {number && (
        <span className={cn(
          "absolute -left-1 -top-2 text-4xl font-bold opacity-[0.06] pointer-events-none select-none",
          valueColors[theme]
        )}>
          {number}
        </span>
      )}

      <div className="relative text-center">
        {/* Icon */}
        {icon && (
          <div className={cn("mb-2", valueColors[theme])}>
            {icon}
          </div>
        )}
        
        {/* Label */}
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        
        {/* Value */}
        <p className={cn(
          "font-bold",
          valueSizes[variant],
          valueColors[theme]
        )}>
          {value}
        </p>
        
        {/* Sublabel */}
        {sublabel && (
          <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>
        )}
      </div>
    </div>
  );
}
