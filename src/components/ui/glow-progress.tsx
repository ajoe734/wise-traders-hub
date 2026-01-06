import { cn } from '@/lib/utils';

interface GlowProgressProps {
  value: number;
  max?: number;
  theme?: 'signals' | 'learning' | 'success' | 'default';
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  label?: string;
  className?: string;
  animated?: boolean;
}

export function GlowProgress({ 
  value, 
  max = 100,
  theme = 'default',
  size = 'md',
  showLabel = false,
  label,
  className,
  animated = false,
}: GlowProgressProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  const themeColors = {
    signals: {
      bg: "bg-signals-accent/20",
      fill: "bg-signals-accent",
      glow: "shadow-[0_0_10px_2px_hsl(var(--signals-accent)/0.5)]",
    },
    learning: {
      bg: "bg-learning-accent/20",
      fill: "bg-learning-accent",
      glow: "shadow-[0_0_10px_2px_hsl(var(--learning-accent)/0.5)]",
    },
    success: {
      bg: "bg-success/20",
      fill: "bg-success",
      glow: "shadow-[0_0_10px_2px_hsl(var(--success)/0.5)]",
    },
    default: {
      bg: "bg-primary/20",
      fill: "bg-primary",
      glow: "shadow-[0_0_10px_2px_hsl(var(--primary)/0.5)]",
    },
  };

  const sizeClasses = {
    sm: "h-1.5",
    md: "h-2.5",
    lg: "h-4",
  };

  const colors = themeColors[theme];

  return (
    <div className={cn("space-y-1", className)}>
      {showLabel && (
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{label || '進度'}</span>
          <span className="font-medium">{Math.round(percentage)}%</span>
        </div>
      )}
      <div className={cn(
        "w-full rounded-full overflow-hidden",
        colors.bg,
        sizeClasses[size]
      )}>
        <div 
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
            colors.fill,
            colors.glow,
            animated && "animate-pulse"
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
