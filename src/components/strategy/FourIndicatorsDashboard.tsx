import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { TrendingUp, Users, UserCheck, Building2 } from 'lucide-react';

export interface FourIndicator {
  id: '有漲' | '有人' | '有人買' | '有大人買';
  label: string;
  description: string;
  status: 'active' | 'warning' | 'inactive';
  value: number; // 0-100
  detail?: string;
}

interface FourIndicatorsDashboardProps {
  indicators: FourIndicator[];
  symbol?: string;
  className?: string;
  compact?: boolean;
}

const iconMap = {
  '有漲': TrendingUp,
  '有人': Users,
  '有人買': UserCheck,
  '有大人買': Building2,
};

const statusColors = {
  active: {
    bg: 'bg-success/10',
    border: 'border-success/30',
    text: 'text-success',
    fill: 'bg-success',
  },
  warning: {
    bg: 'bg-warning/10',
    border: 'border-warning/30',
    text: 'text-warning',
    fill: 'bg-warning',
  },
  inactive: {
    bg: 'bg-muted',
    border: 'border-border',
    text: 'text-muted-foreground',
    fill: 'bg-muted-foreground/30',
  },
};

export function FourIndicatorsDashboard({ 
  indicators, 
  symbol, 
  className,
  compact = false 
}: FourIndicatorsDashboardProps) {
  const activeCount = indicators.filter(i => i.status === 'active').length;
  const allActive = activeCount === 4;

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        {indicators.map((indicator) => {
          const Icon = iconMap[indicator.id];
          const colors = statusColors[indicator.status];
          return (
            <div
              key={indicator.id}
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-lg border",
                colors.bg,
                colors.border
              )}
              title={`${indicator.id}: ${indicator.label}`}
            >
              <Icon className={cn("h-4 w-4", colors.text)} />
            </div>
          );
        })}
        {allActive && (
          <Badge variant="default" className="bg-success text-success-foreground animate-pulse">
            4有同步
          </Badge>
        )}
      </div>
    );
  }

  return (
    <Card className={cn("border-advisor/20", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            「4有」指標儀表板
            {symbol && (
              <Badge variant="outline" className="font-mono text-xs">
                {symbol}
              </Badge>
            )}
          </CardTitle>
          {allActive && (
            <Badge variant="default" className="bg-success text-success-foreground animate-pulse">
              🔥 4有同步觸發
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          同步觸發數：{activeCount}/4
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {indicators.map((indicator) => {
          const Icon = iconMap[indicator.id];
          const colors = statusColors[indicator.status];
          
          return (
            <div
              key={indicator.id}
              className={cn(
                "p-3 rounded-lg border transition-all",
                colors.bg,
                colors.border,
                indicator.status === 'active' && "shadow-sm"
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  "flex items-center justify-center w-10 h-10 rounded-lg",
                  indicator.status === 'active' ? 'bg-success/20' : 'bg-background'
                )}>
                  <Icon className={cn("h-5 w-5", colors.text)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold">{indicator.id}</span>
                    <span className="text-sm text-muted-foreground">
                      {indicator.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-1">
                    {indicator.description}
                  </p>
                </div>
                <div className="text-right">
                  <div className={cn(
                    "text-lg font-bold",
                    colors.text
                  )}>
                    {indicator.value}%
                  </div>
                  {indicator.detail && (
                    <p className="text-xs text-muted-foreground">
                      {indicator.detail}
                    </p>
                  )}
                </div>
              </div>
              {/* Progress bar */}
              <div className="mt-2 h-1.5 bg-border/50 dark:bg-white/10 rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", colors.fill)}
                  style={{ width: `${indicator.value}%` }}
                />
              </div>
            </div>
          );
        })}
        
        {/* Signal strength summary */}
        <div className={cn(
          "mt-4 p-3 rounded-lg text-center",
          allActive 
            ? "bg-success/10 border border-success/30" 
            : activeCount >= 3 
              ? "bg-warning/10 border border-warning/30"
              : "bg-muted border border-border"
        )}>
          <p className={cn(
            "font-semibold",
            allActive ? "text-success" : activeCount >= 3 ? "text-warning" : "text-muted-foreground"
          )}>
            {allActive 
              ? '🚀 強烈買進訊號！' 
              : activeCount >= 3 
                ? '⚡ 訊號偏多，可留意' 
                : activeCount >= 2
                  ? '觀望中，等待更多確認'
                  : '訊號不足，暫不操作'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// Default mock data for demonstration
export const mockFourIndicators: FourIndicator[] = [
  {
    id: '有漲',
    label: '股價強勢',
    description: '股價站上均線、盤中表現強勢',
    status: 'active',
    value: 85,
    detail: '突破20MA',
  },
  {
    id: '有人',
    label: '買盤積極',
    description: '委買量大於委賣量',
    status: 'active',
    value: 92,
    detail: '買賣比 1.8',
  },
  {
    id: '有人買',
    label: '散戶買超',
    description: '散戶買超訊號',
    status: 'warning',
    value: 65,
    detail: '小幅買超',
  },
  {
    id: '有大人買',
    label: '主力進場',
    description: '大戶/法人連續買超',
    status: 'active',
    value: 78,
    detail: '連3日買超',
  },
];
