// Monthly Return Heatmap Component
import { EquityPoint } from '@/types/strategy';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MonthlyHeatmapProps {
  data: EquityPoint[];
  isDelayed?: boolean;
  className?: string;
}

interface MonthlyReturn {
  year: number;
  month: number;
  monthLabel: string;
  returnPct: number;
}

export function MonthlyHeatmap({ data, isDelayed, className }: MonthlyHeatmapProps) {
  // Calculate monthly returns from equity data
  const monthlyReturns: MonthlyReturn[] = [];
  
  // Group data by month
  const monthGroups: Record<string, EquityPoint[]> = {};
  data.forEach(point => {
    const date = new Date(point.date);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (!monthGroups[key]) {
      monthGroups[key] = [];
    }
    monthGroups[key].push(point);
  });

  // Calculate return for each month
  Object.entries(monthGroups).forEach(([key, points]) => {
    if (points.length < 2) return;
    
    const sortedPoints = points.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const startEquity = sortedPoints[0].equity;
    const endEquity = sortedPoints[sortedPoints.length - 1].equity;
    const returnPct = ((endEquity - startEquity) / startEquity) * 100;
    
    const [year, month] = key.split('-').map(Number);
    const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    
    monthlyReturns.push({
      year,
      month,
      monthLabel: monthNames[month],
      returnPct,
    });
  });

  // Sort by date and take last 12 months
  const sortedReturns = monthlyReturns
    .sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month))
    .slice(-12);

  // Get color intensity based on return
  const getColorClass = (returnPct: number) => {
    if (returnPct >= 8) return 'bg-success text-success-foreground';
    if (returnPct >= 4) return 'bg-success/70 text-success-foreground';
    if (returnPct >= 2) return 'bg-success/40 text-foreground';
    if (returnPct >= 0) return 'bg-success/20 text-foreground';
    if (returnPct >= -2) return 'bg-destructive/20 text-foreground';
    if (returnPct >= -4) return 'bg-destructive/40 text-foreground';
    if (returnPct >= -8) return 'bg-destructive/70 text-destructive-foreground';
    return 'bg-destructive text-destructive-foreground';
  };

  // Calculate totals
  const totalReturn = sortedReturns.reduce((sum, m) => sum + m.returnPct, 0);
  const positiveMonths = sortedReturns.filter(m => m.returnPct >= 0).length;
  const avgMonthlyReturn = sortedReturns.length > 0 ? totalReturn / sortedReturns.length : 0;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            月度報酬
          </CardTitle>
          {isDelayed && (
            <Badge variant="outline" className="text-[10px] bg-mentor/10 text-mentor border-mentor/20">
              T+7
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Heatmap Grid */}
        <div className="grid grid-cols-4 gap-2">
          {sortedReturns.map((month, index) => (
            <div
              key={index}
              className={cn(
                "rounded-lg p-2 text-center transition-all",
                getColorClass(month.returnPct)
              )}
            >
              <p className="text-[10px] opacity-80">{month.monthLabel}</p>
              <p className="text-sm font-bold">
                {month.returnPct >= 0 ? '+' : ''}{month.returnPct.toFixed(1)}%
              </p>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex justify-center gap-1 mt-4">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-destructive" />
            <span className="text-[10px] text-muted-foreground">虧損</span>
          </div>
          <div className="flex items-center gap-1 ml-2">
            <div className="w-3 h-3 rounded bg-muted" />
            <span className="text-[10px] text-muted-foreground">持平</span>
          </div>
          <div className="flex items-center gap-1 ml-2">
            <div className="w-3 h-3 rounded bg-success" />
            <span className="text-[10px] text-muted-foreground">獲利</span>
          </div>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">正報酬月數</p>
            <p className="text-lg font-bold">{positiveMonths}/{sortedReturns.length}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">月均報酬</p>
            <p className={cn(
              "text-lg font-bold",
              avgMonthlyReturn >= 0 ? "text-success" : "text-destructive"
            )}>
              {avgMonthlyReturn >= 0 ? '+' : ''}{avgMonthlyReturn.toFixed(1)}%
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">累計報酬</p>
            <p className={cn(
              "text-lg font-bold",
              totalReturn >= 0 ? "text-success" : "text-destructive"
            )}>
              {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(1)}%
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
