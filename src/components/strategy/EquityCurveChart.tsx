// Equity Curve Chart Component (Placeholder with Recharts)
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { EquityPoint, PerfPeriod } from '@/types/strategy';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TrendingUp } from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine,
  Area,
  ComposedChart,
} from 'recharts';

interface EquityCurveChartProps {
  data: EquityPoint[];
  isDelayed?: boolean;
  className?: string;
}

type ChartPeriod = '1M' | '3M' | '6M' | '1Y';

export function EquityCurveChart({ data, isDelayed, className }: EquityCurveChartProps) {
  const [period, setPeriod] = useState<ChartPeriod>('1Y');

  // Filter data based on period
  const filterData = (data: EquityPoint[], period: ChartPeriod): EquityPoint[] => {
    const days = period === '1M' ? 30 : period === '3M' ? 90 : period === '6M' ? 180 : 365;
    return data.slice(-days);
  };

  const filteredData = filterData(data, period);
  const latestEquity = filteredData[filteredData.length - 1]?.equity ?? 100;
  const startEquity = filteredData[0]?.equity ?? 100;
  const periodReturn = ((latestEquity - startEquity) / startEquity) * 100;

  // Find min/max for Y axis
  const equities = filteredData.map(d => d.equity);
  const minEquity = Math.min(...equities) * 0.98;
  const maxEquity = Math.max(...equities) * 1.02;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            淨值曲線
          </CardTitle>
          {isDelayed && (
            <Badge variant="outline" className="text-[10px] bg-mentor/10 text-mentor border-mentor/20">
              T+7
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Period Selector */}
        <div className="flex gap-2 mb-4">
          {(['1M', '3M', '6M', '1Y'] as ChartPeriod[]).map(p => (
            <Button
              key={p}
              variant={period === p ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPeriod(p)}
              className="flex-1 text-xs"
            >
              {p === '1M' ? '1個月' : p === '3M' ? '3個月' : p === '6M' ? '6個月' : '1年'}
            </Button>
          ))}
        </div>

        {/* Chart */}
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={filteredData}>
              <defs>
                <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis 
                dataKey="date" 
                tick={{ fontSize: 10 }}
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return `${date.getMonth() + 1}/${date.getDate()}`;
                }}
                interval="preserveStartEnd"
              />
              <YAxis 
                domain={[minEquity, maxEquity]}
                tick={{ fontSize: 10 }}
                tickFormatter={(value) => value.toFixed(0)}
                width={40}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                formatter={(value: number) => [`${value.toFixed(2)}`, '淨值']}
                labelFormatter={(label) => new Date(label).toLocaleDateString('zh-TW')}
              />
              <ReferenceLine y={100} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
              <Area 
                type="monotone" 
                dataKey="equity" 
                fill="url(#equityGradient)"
                stroke="none"
              />
              <Line 
                type="monotone" 
                dataKey="equity" 
                stroke="hsl(var(--primary))" 
                strokeWidth={2}
                dot={false}
              />
              {filteredData[0]?.benchmarkEquity && (
                <Line 
                  type="monotone" 
                  dataKey="benchmarkEquity" 
                  stroke="hsl(var(--muted-foreground))" 
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  dot={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Period Return */}
        <div className="mt-3 text-center">
          <p className="text-xs text-muted-foreground">
            {period === '1M' ? '近1個月' : period === '3M' ? '近3個月' : period === '6M' ? '近6個月' : '近1年'}報酬
          </p>
          <p className={cn(
            "text-xl font-bold",
            periodReturn >= 0 ? "text-success" : "text-destructive"
          )}>
            {periodReturn >= 0 ? '+' : ''}{periodReturn.toFixed(1)}%
          </p>
        </div>

        <p className="text-xs text-muted-foreground text-center mt-2">
          虛線為參考指數，實線為策略淨值
        </p>
      </CardContent>
    </Card>
  );
}
