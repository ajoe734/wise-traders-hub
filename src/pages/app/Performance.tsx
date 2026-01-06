import { Link } from 'react-router-dom';
import { SignalsLayout } from '@/components/layouts/SignalsLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown,
  Target,
  Percent,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  Activity
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Mock performance data
const performanceStats = {
  totalReturn: 12.5,
  winRate: 68,
  totalTrades: 47,
  avgHoldingDays: 4.2,
  maxDrawdown: -8.3,
  sharpeRatio: 1.85,
  profitFactor: 2.1,
  avgWin: 5.2,
  avgLoss: -2.8,
};

// Monthly returns
const monthlyReturns = [
  { month: '2024-07', return: 3.2 },
  { month: '2024-08', return: -1.5 },
  { month: '2024-09', return: 4.8 },
  { month: '2024-10', return: 2.1 },
  { month: '2024-11', return: 5.6 },
  { month: '2024-12', return: 1.8 },
  { month: '2025-01', return: 2.4 },
];

// Recent trades
const recentTrades = [
  { symbol: '3443.TW', name: '創意', action: 'SELL', pnl: 5.2, date: '2025-01-04' },
  { symbol: '2454.TW', name: '聯發科', action: 'SELL', pnl: -2.1, date: '2025-01-03' },
  { symbol: '6770.TW', name: '力積電', action: 'SELL', pnl: 3.8, date: '2025-01-02' },
  { symbol: '2330.TW', name: '台積電', action: 'SELL', pnl: 4.5, date: '2024-12-28' },
  { symbol: '3034.TW', name: '聯詠', action: 'SELL', pnl: -1.8, date: '2024-12-27' },
];

export default function Performance() {
  const getMonthLabel = (monthStr: string) => {
    const [year, month] = monthStr.split('-');
    return `${month}月`;
  };

  return (
    <SignalsLayout>
      <div className="p-4 space-y-6 max-w-lg mx-auto pb-24">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-signals-accent" />
              績效統計
            </h1>
            <p className="text-sm text-muted-foreground mt-1">你的跟單成績單</p>
          </div>
          <Badge variant="outline" className="text-xs">
            統計至今日
          </Badge>
        </div>

        {/* Total Return Card */}
        <Card className="border-signals-accent/20 bg-gradient-to-br from-signals-accent/5 to-transparent">
          <CardContent className="p-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-2">累計報酬率</p>
              <p className={cn(
                "text-4xl font-bold flex items-center justify-center gap-2",
                performanceStats.totalReturn >= 0 ? "text-success" : "text-destructive"
              )}>
                {performanceStats.totalReturn >= 0 ? (
                  <TrendingUp className="h-8 w-8" />
                ) : (
                  <TrendingDown className="h-8 w-8" />
                )}
                {performanceStats.totalReturn >= 0 ? '+' : ''}{performanceStats.totalReturn}%
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                近 6 個月統計
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-4 text-center">
              <Target className="h-5 w-5 text-signals-accent mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">勝率</p>
              <p className="text-2xl font-bold">{performanceStats.winRate}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <Activity className="h-5 w-5 text-signals-accent mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">總交易數</p>
              <p className="text-2xl font-bold">{performanceStats.totalTrades}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <Calendar className="h-5 w-5 text-signals-accent mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">平均持有</p>
              <p className="text-2xl font-bold">{performanceStats.avgHoldingDays}<span className="text-sm">天</span></p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <Percent className="h-5 w-5 text-destructive mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">最大回撤</p>
              <p className="text-2xl font-bold text-destructive">{performanceStats.maxDrawdown}%</p>
            </CardContent>
          </Card>
        </div>

        {/* Detailed Stats */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">進階指標</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">夏普比率</span>
              <span className="font-semibold">{performanceStats.sharpeRatio}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">獲利因子</span>
              <span className="font-semibold">{performanceStats.profitFactor}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">平均獲利</span>
              <span className="font-semibold text-success">+{performanceStats.avgWin}%</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-muted-foreground">平均虧損</span>
              <span className="font-semibold text-destructive">{performanceStats.avgLoss}%</span>
            </div>
          </CardContent>
        </Card>

        {/* Monthly Returns */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4 text-signals-accent" />
              月度報酬
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 h-32">
              {monthlyReturns.map((item) => {
                const maxReturn = Math.max(...monthlyReturns.map(r => Math.abs(r.return)));
                const height = (Math.abs(item.return) / maxReturn) * 100;
                return (
                  <div key={item.month} className="flex-1 flex flex-col items-center gap-1">
                    <div className="flex-1 w-full flex items-end justify-center">
                      <div 
                        className={cn(
                          "w-full max-w-8 rounded-t transition-all",
                          item.return >= 0 ? "bg-success" : "bg-destructive"
                        )}
                        style={{ height: `${height}%`, minHeight: '4px' }}
                      />
                    </div>
                    <span className={cn(
                      "text-xs font-medium",
                      item.return >= 0 ? "text-success" : "text-destructive"
                    )}>
                      {item.return > 0 ? '+' : ''}{item.return}%
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {getMonthLabel(item.month)}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Recent Trades */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">近期已結算交易</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {recentTrades.map((trade, index) => (
                <div key={index} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{trade.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {trade.symbol} · {trade.date}
                    </p>
                  </div>
                  <div className={cn(
                    "flex items-center gap-1 font-semibold",
                    trade.pnl >= 0 ? "text-success" : "text-destructive"
                  )}>
                    {trade.pnl >= 0 ? (
                      <ArrowUpRight className="h-4 w-4" />
                    ) : (
                      <ArrowDownRight className="h-4 w-4" />
                    )}
                    {trade.pnl > 0 ? '+' : ''}{trade.pnl}%
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </SignalsLayout>
  );
}
