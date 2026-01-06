import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface SectionHeaderProps {
  number?: string;
  tag?: string;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  theme?: 'signals' | 'learning' | 'default';
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function SectionHeader({ 
  number, 
  tag, 
  title, 
  subtitle,
  icon,
  theme = 'default',
  className,
  size = 'md'
}: SectionHeaderProps) {
  const themeColors = {
    signals: 'text-signals-accent',
    learning: 'text-learning-accent',
    default: 'text-primary',
  };

  const sizeClasses = {
    sm: 'text-base',
    md: 'text-lg',
    lg: 'text-xl',
  };

  return (
    <div className={cn("relative", className)}>
      {/* Large decorative number */}
      {number && (
        <span className={cn(
          "absolute -left-1 -top-4 text-5xl font-bold opacity-[0.08] pointer-events-none select-none",
          theme === 'signals' && "text-signals-accent",
          theme === 'learning' && "text-learning-accent"
        )}>
          {number}
        </span>
      )}
      
      <div className="relative">
        {/* Tag line */}
        {tag && (
          <div className={cn(
            "flex items-center gap-1.5 mb-1",
            themeColors[theme]
          )}>
            {icon}
            <span className="text-xs font-semibold uppercase tracking-wider">{tag}</span>
          </div>
        )}
        
        {/* Title */}
        <h2 className={cn(
          "font-bold tracking-tight",
          sizeClasses[size]
        )}>
          {title}
        </h2>
        
        {/* Subtitle */}
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
