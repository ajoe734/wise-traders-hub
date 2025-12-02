// Performance Metrics Tiles Component
import { cn } from '@/lib/utils';
import { PerformanceSummary } from '@/types/strategy';
import { TrendingUp, TrendingDown, Target, BarChart3, Trophy, Clock } from 'lucide-react';

interface PerformanceMetricsProps {
  summary: PerformanceSummary;
  isDelayed?: boolean;
  className?: string;
}

export function PerformanceMetrics({ summary, isDelayed, className }: PerformanceMetricsProps) {
  const metrics = [
    {
      label: '累積報酬',
      value: summary.sinceInceptionReturnPct,
      format: 'percent',
      icon: TrendingUp,
      colorByValue: true,
    },
    {
      label: '年化報酬',
      value: summary.annualizedReturnPct,
      format: 'percent',
      icon: BarChart3,
      colorByValue: true,
    },
    {
      label: '最大回撤',
      value: summary.maxDrawdownPct,
      format: 'percent',
      icon: TrendingDown,
      alwaysNegative: true,
    },
    {
      label: '勝率',
      value: summary.winRatePct,
      format: 'percent',
      icon: Target,
    },
    {
      label: '獲利因子',
      value: summary.profitFactor,
      format: 'number',
      icon: Trophy,
    },
    {
      label: '交易次數',
      value: summary.tradesCount,
      format: 'count',
      icon: Clock,
    },
  ];

  return (
    <div className={cn("grid grid-cols-2 sm:grid-cols-3 gap-3", className)}>
      {metrics.map((metric, idx) => {
        if (metric.value === undefined) return null;
        
        const Icon = metric.icon;
        const isPositive = metric.value > 0;
        const isNegative = metric.value < 0;
        
        let displayValue = '';
        if (metric.format === 'percent') {
          const sign = metric.value > 0 && !metric.alwaysNegative ? '+' : '';
          displayValue = `${sign}${metric.value.toFixed(1)}%`;
        } else if (metric.format === 'number') {
          displayValue = metric.value.toFixed(2);
        } else {
          displayValue = metric.value.toString();
        }

        let valueColor = 'text-foreground';
        if (metric.colorByValue) {
          valueColor = isPositive ? 'text-success' : isNegative ? 'text-destructive' : 'text-foreground';
        } else if (metric.alwaysNegative) {
          valueColor = 'text-warning';
        }

        return (
          <div 
            key={idx}
            className="p-3 bg-muted/30 rounded-lg text-center relative"
          >
            {isDelayed && idx === 0 && (
              <span className="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 bg-mentor/10 text-mentor rounded">
                T+7
              </span>
            )}
            <div className="flex items-center justify-center gap-1 mb-1">
              <Icon className="h-3 w-3 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">{metric.label}</p>
            </div>
            <p className={cn("text-lg font-bold", valueColor)}>
              {displayValue}
            </p>
          </div>
        );
      })}
    </div>
  );
}
