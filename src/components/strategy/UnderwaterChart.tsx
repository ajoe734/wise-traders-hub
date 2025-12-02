import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { EquityPoint } from '@/types/strategy';
import { cn } from '@/lib/utils';

interface UnderwaterChartProps {
  data: EquityPoint[];
  isDelayed?: boolean;
  className?: string;
}

export function UnderwaterChart({ data, isDelayed, className }: UnderwaterChartProps) {
  // Format data for the chart - ensure drawdownPct is negative for underwater effect
  const chartData = data.map((point) => ({
    date: point.date,
    drawdown: point.drawdownPct ?? 0,
  }));

  // Find max drawdown for display
  const maxDrawdown = Math.min(...chartData.map(d => d.drawdown));
  const currentDrawdown = chartData[chartData.length - 1]?.drawdown ?? 0;

  // Calculate Y-axis domain - show from 0 to slightly below max drawdown
  const yMin = Math.floor(maxDrawdown / 5) * 5 - 5; // Round down to nearest 5 and add buffer

  return (
    <Card className={cn("", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">回撤水下圖</CardTitle>
          {isDelayed && (
            <Badge variant="outline" className="text-xs bg-mentor/10 text-mentor border-mentor/30">
              T+7
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          顯示策略淨值相對歷史高點的回撤幅度
        </p>
      </CardHeader>
      <CardContent>
        {/* Summary stats */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="text-center p-3 rounded-lg bg-muted/30">
            <p className="text-xs text-muted-foreground mb-1">最大回撤</p>
            <p className="text-lg font-bold text-destructive">
              {maxDrawdown.toFixed(1)}%
            </p>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/30">
            <p className="text-xs text-muted-foreground mb-1">當前回撤</p>
            <p className={cn(
              "text-lg font-bold",
              currentDrawdown < -5 ? "text-destructive" : currentDrawdown < 0 ? "text-warning" : "text-success"
            )}>
              {currentDrawdown.toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Chart */}
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
            >
              <defs>
                <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.1} />
                  <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0.4} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return `${date.getMonth() + 1}/${date.getDate()}`;
                }}
                interval="preserveStartEnd"
                minTickGap={50}
              />
              <YAxis
                domain={[yMin, 0]}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(value) => `${value}%`}
                width={45}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                formatter={(value: number) => [`${value.toFixed(2)}%`, '回撤']}
                labelFormatter={(label) => {
                  const date = new Date(label);
                  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
                }}
              />
              <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <Area
                type="monotone"
                dataKey="drawdown"
                stroke="hsl(var(--destructive))"
                strokeWidth={1.5}
                fill="url(#drawdownGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-destructive/30" />
            <span>回撤區域</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-8 h-0.5 border-t border-dashed border-muted-foreground" />
            <span>零回撤線</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground text-center mt-3">
          回撤 = (當前淨值 - 歷史高點) / 歷史高點
        </p>
      </CardContent>
    </Card>
  );
}
