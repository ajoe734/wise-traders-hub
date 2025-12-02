import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line } from 'recharts';
import { Trophy, TrendingUp, Target, Flame, Calendar } from 'lucide-react';

interface MonthlyRecord {
  month: string;
  limitUpCount: number;
  totalTrades: number;
  winRate: number;
  returnPct: number;
  bestStock: string;
}

interface MonthlyLimitUpRecordProps {
  className?: string;
}

// Mock monthly data for 趙彭博
const monthlyData: MonthlyRecord[] = [
  { month: '2024-06', limitUpCount: 5, totalTrades: 28, winRate: 64, returnPct: 12.5, bestStock: '長榮' },
  { month: '2024-07', limitUpCount: 8, totalTrades: 32, winRate: 72, returnPct: 18.2, bestStock: '陽明' },
  { month: '2024-08', limitUpCount: 6, totalTrades: 30, winRate: 67, returnPct: 14.8, bestStock: '聯電' },
  { month: '2024-09', limitUpCount: 10, totalTrades: 35, winRate: 74, returnPct: 22.5, bestStock: '創意' },
  { month: '2024-10', limitUpCount: 7, totalTrades: 29, winRate: 69, returnPct: 16.3, bestStock: '世芯-KY' },
  { month: '2024-11', limitUpCount: 12, totalTrades: 38, winRate: 76, returnPct: 28.8, bestStock: '力積電' },
];

// Calculate cumulative return
const cumulativeData = monthlyData.map((item, index) => {
  const cumReturn = monthlyData.slice(0, index + 1).reduce((acc, curr) => {
    return acc * (1 + curr.returnPct / 100);
  }, 1);
  return {
    ...item,
    cumReturnPct: Math.round((cumReturn - 1) * 100 * 10) / 10,
  };
});

export function MonthlyLimitUpRecord({ className }: MonthlyLimitUpRecordProps) {
  const totalLimitUps = monthlyData.reduce((sum, m) => sum + m.limitUpCount, 0);
  const avgWinRate = Math.round(monthlyData.reduce((sum, m) => sum + m.winRate, 0) / monthlyData.length);
  const totalReturn = cumulativeData[cumulativeData.length - 1].cumReturnPct;
  const bestMonth = monthlyData.reduce((best, curr) => curr.limitUpCount > best.limitUpCount ? curr : best);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-gradient-to-br from-yellow-500/10 to-amber-500/5 border-yellow-500/20">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <Flame className="h-5 w-5 text-yellow-500" />
              <span className="text-sm text-muted-foreground">累計捕捉</span>
            </div>
            <p className="text-3xl font-bold">{totalLimitUps}</p>
            <p className="text-xs text-muted-foreground">檔漲停股</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-success/10 to-emerald-500/5 border-success/20">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-5 w-5 text-success" />
              <span className="text-sm text-muted-foreground">累計報酬</span>
            </div>
            <p className="text-3xl font-bold text-success">+{totalReturn}%</p>
            <p className="text-xs text-muted-foreground">近 6 個月</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-5 w-5 text-primary" />
              <span className="text-sm text-muted-foreground">平均勝率</span>
            </div>
            <p className="text-3xl font-bold">{avgWinRate}%</p>
            <p className="text-xs text-muted-foreground">交易勝率</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <Trophy className="h-5 w-5 text-yellow-500" />
              <span className="text-sm text-muted-foreground">最佳月份</span>
            </div>
            <p className="text-xl font-bold">{bestMonth.month.split('-')[1]}月</p>
            <p className="text-xs text-muted-foreground">{bestMonth.limitUpCount} 檔漲停</p>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Limit Up Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Flame className="h-4 w-4 text-yellow-500" />
            月度漲停捕捉紀錄
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis 
                  dataKey="month" 
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => v.split('-')[1] + '月'}
                />
                <YAxis />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload as MonthlyRecord;
                      return (
                        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
                          <p className="font-semibold">{data.month}</p>
                          <p className="text-sm text-yellow-500">漲停捕捉：{data.limitUpCount} 檔</p>
                          <p className="text-sm text-muted-foreground">總交易：{data.totalTrades} 筆</p>
                          <p className="text-sm text-muted-foreground">勝率：{data.winRate}%</p>
                          <p className="text-sm text-success">報酬：+{data.returnPct}%</p>
                          <p className="text-sm text-muted-foreground">最佳：{data.bestStock}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="limitUpCount" radius={[4, 4, 0, 0]}>
                  {monthlyData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`}
                      fill={entry.limitUpCount >= 10 ? 'hsl(var(--success))' : 
                            entry.limitUpCount >= 7 ? 'hsl(var(--chart-2))' : 
                            'hsl(var(--warning))'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Cumulative Return Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-success" />
            累計報酬曲線
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cumulativeData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis 
                  dataKey="month"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => v.split('-')[1] + '月'}
                />
                <YAxis tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
                          <p className="font-semibold">{data.month}</p>
                          <p className="text-sm text-success">累計報酬：+{data.cumReturnPct}%</p>
                          <p className="text-sm text-muted-foreground">當月報酬：+{data.returnPct}%</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Line 
                  type="monotone" 
                  dataKey="cumReturnPct" 
                  stroke="hsl(var(--success))" 
                  strokeWidth={3}
                  dot={{ fill: 'hsl(var(--success))', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Monthly Details Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            月度詳細紀錄
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {monthlyData.slice().reverse().map((record) => (
              <div
                key={record.month}
                className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <Badge variant="outline">
                    {record.month.split('-')[1]}月
                  </Badge>
                  <div>
                    <div className="flex items-center gap-2">
                      <Flame className="h-4 w-4 text-yellow-500" />
                      <span className="font-semibold">{record.limitUpCount} 檔漲停</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      最佳：{record.bestStock}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-success font-semibold">+{record.returnPct}%</p>
                  <p className="text-xs text-muted-foreground">
                    勝率 {record.winRate}%
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        ⚠️ 歷史績效不代表未來表現，僅供教學參考
      </p>
    </div>
  );
}
