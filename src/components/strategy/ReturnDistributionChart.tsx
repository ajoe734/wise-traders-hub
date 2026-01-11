// Return Distribution Histogram Component
import { Trade } from '@/types/strategy';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReturnDistributionChartProps {
  trades: Trade[];
  isDelayed?: boolean;
  className?: string;
}

interface DistributionBucket {
  range: string;
  count: number;
  isPositive: boolean;
  rangeStart: number;
}

export function ReturnDistributionChart({ trades, isDelayed, className }: ReturnDistributionChartProps) {
  // Define buckets for return distribution
  const buckets: { min: number; max: number; label: string }[] = [
    { min: -Infinity, max: -10, label: '<-10%' },
    { min: -10, max: -5, label: '-10~-5%' },
    { min: -5, max: -2, label: '-5~-2%' },
    { min: -2, max: 0, label: '-2~0%' },
    { min: 0, max: 2, label: '0~2%' },
    { min: 2, max: 5, label: '2~5%' },
    { min: 5, max: 10, label: '5~10%' },
    { min: 10, max: Infinity, label: '>10%' },
  ];

  // Count trades in each bucket
  const distribution: DistributionBucket[] = buckets.map((bucket, index) => {
    const count = trades.filter(t => {
      const pnl = t.pnlPct ?? 0;
      if (bucket.max === Infinity) return pnl >= bucket.min;
      if (bucket.min === -Infinity) return pnl < bucket.max;
      return pnl >= bucket.min && pnl < bucket.max;
    }).length;
    
    return {
      range: bucket.label,
      count,
      isPositive: bucket.min >= 0,
      rangeStart: index,
    };
  });

  // Calculate stats
  const closedTrades = trades.filter(t => t.pnlPct !== undefined);
  const winTrades = closedTrades.filter(t => (t.pnlPct ?? 0) > 0);
  const avgWin = winTrades.length > 0 
    ? winTrades.reduce((sum, t) => sum + (t.pnlPct ?? 0), 0) / winTrades.length 
    : 0;
  const loseTrades = closedTrades.filter(t => (t.pnlPct ?? 0) <= 0);
  const avgLoss = loseTrades.length > 0 
    ? loseTrades.reduce((sum, t) => sum + (t.pnlPct ?? 0), 0) / loseTrades.length 
    : 0;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            報酬分布
          </CardTitle>
          {isDelayed && (
            <Badge variant="outline" className="text-[10px] bg-mentor/10 text-mentor border-mentor/20">
              T+7
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Chart */}
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={distribution} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
              <XAxis 
                dataKey="range" 
                tick={{ fontSize: 9 }}
                interval={0}
                angle={-45}
                textAnchor="end"
                height={50}
              />
              <YAxis 
                tick={{ fontSize: 10 }}
                width={30}
                allowDecimals={false}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                formatter={(value: number) => [`${value} 筆`, '交易數']}
              />
              <ReferenceLine x="0~2%" stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {distribution.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`}
                    fill={entry.isPositive ? 'hsl(var(--success))' : 'hsl(var(--destructive))'}
                    fillOpacity={0.8}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">平均獲利</p>
            <p className="text-lg font-bold text-success">+{avgWin.toFixed(1)}%</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">平均虧損</p>
            <p className="text-lg font-bold text-destructive">{avgLoss.toFixed(1)}%</p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground text-center mt-3">
          紅色為獲利交易，綠色為虧損交易
        </p>
      </CardContent>
    </Card>
  );
}
