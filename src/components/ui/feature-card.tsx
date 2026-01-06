import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface FeatureCardProps {
  children: ReactNode;
  theme?: 'signals' | 'learning' | 'default';
  variant?: 'default' | 'highlight' | 'glow';
  className?: string;
  onClick?: () => void;
  href?: string;
}

export function FeatureCard({ 
  children, 
  theme = 'default',
  variant = 'default',
  className,
  onClick,
}: FeatureCardProps) {
  const baseClasses = cn(
    "relative rounded-xl overflow-hidden transition-all duration-300",
    "bg-gradient-to-b from-foreground/[0.03] to-foreground/[0.08]",
    "border border-foreground/[0.08]",
    "hover:scale-[1.02] hover:brightness-110",
    onClick && "cursor-pointer"
  );

  const themeClasses = {
    signals: "hover:border-signals-accent/30 hover:shadow-[0_0_20px_-5px_hsl(var(--signals-accent)/0.3)]",
    learning: "hover:border-learning-accent/30 hover:shadow-[0_0_20px_-5px_hsl(var(--learning-accent)/0.3)]",
    default: "hover:border-primary/30 hover:shadow-[0_0_20px_-5px_hsl(var(--primary)/0.3)]",
  };

  const variantClasses = {
    default: "",
    highlight: cn(
      "border-2",
      theme === 'signals' && "border-signals-accent/40 bg-gradient-to-b from-signals-accent/5 to-signals-accent/10",
      theme === 'learning' && "border-learning-accent/40 bg-gradient-to-b from-learning-accent/5 to-learning-accent/10",
      theme === 'default' && "border-primary/40 bg-gradient-to-b from-primary/5 to-primary/10"
    ),
    glow: cn(
      theme === 'signals' && "shadow-[0_0_30px_-10px_hsl(var(--signals-accent)/0.4)]",
      theme === 'learning' && "shadow-[0_0_30px_-10px_hsl(var(--learning-accent)/0.4)]",
      theme === 'default' && "shadow-[0_0_30px_-10px_hsl(var(--primary)/0.4)]"
    ),
  };

  // Corner accent dot
  const accentDot = (
    <div className={cn(
      "absolute top-3 right-3 w-2 h-2 rounded-full",
      theme === 'signals' && "bg-signals-accent",
      theme === 'learning' && "bg-learning-accent",
      theme === 'default' && "bg-primary"
    )} />
  );

  return (
    <div 
      className={cn(baseClasses, themeClasses[theme], variantClasses[variant], className)}
      onClick={onClick}
    >
      {accentDot}
      {children}
    </div>
  );
}
