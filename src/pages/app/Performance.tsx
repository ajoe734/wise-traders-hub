import { UnifiedAppLayout } from '@/components/layouts/UnifiedAppLayout';
import { Badge } from '@/components/ui/badge';
import { SectionHeader } from '@/components/ui/section-header';
import { StatCard } from '@/components/ui/stat-card';
import { FeatureCard } from '@/components/ui/feature-card';
import { GlowProgress } from '@/components/ui/glow-progress';
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown,
  Target,
  Percent,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Trophy,
  Zap
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

  const maxReturn = Math.max(...monthlyReturns.map(r => Math.abs(r.return)));

  return (
    <UnifiedAppLayout>
      <div className="p-4 space-y-6 max-w-lg mx-auto pb-24">
        {/* Header */}
        <div className="relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-signals-accent to-signals-accent/70 flex items-center justify-center shadow-[0_0_20px_-5px_hsl(var(--signals-accent)/0.5)]">
                  <BarChart3 className="h-6 w-6 text-white" />
                </div>
              </div>
              <div>
                <p className="text-xs text-signals-accent font-semibold tracking-wider uppercase">績效統計</p>
                <h1 className="text-xl font-bold">你的跟單成績單</h1>
              </div>
            </div>
            <Badge variant="outline" className="text-xs border-signals-accent/30">
              統計至今日
            </Badge>
          </div>
        </div>

        {/* Total Return Card - Hero Style */}
        <FeatureCard theme="signals" variant="highlight" className="p-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Trophy className="h-5 w-5 text-signals-accent" />
            <span className="text-sm text-muted-foreground">累計報酬率</span>
          </div>
          <p className={cn(
            "text-5xl font-bold flex items-center justify-center gap-3 animate-number-pop",
            performanceStats.totalReturn >= 0 ? "text-success" : "text-destructive"
          )}>
            {performanceStats.totalReturn >= 0 ? (
              <TrendingUp className="h-10 w-10" />
            ) : (
              <TrendingDown className="h-10 w-10" />
            )}
            <span className={cn(
              performanceStats.totalReturn >= 0 && "drop-shadow-[0_0_20px_hsl(var(--success)/0.6)]"
            )}>
              {performanceStats.totalReturn >= 0 ? '+' : ''}{performanceStats.totalReturn}%
            </span>
          </p>
          <p className="text-sm text-muted-foreground mt-3">
            近 6 個月統計
          </p>
        </FeatureCard>

        {/* Key Metrics Grid */}
        <section>
          <SectionHeader
            number="01"
            tag="關鍵指標"
            title="核心數據"
            icon={<Zap className="h-3.5 w-3.5" />}
            theme="signals"
            className="mb-4"
          />
          
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              number="01"
              label="勝率"
              value={`${performanceStats.winRate}%`}
              icon={<Target className="h-5 w-5 mx-auto" />}
              theme="signals"
            />
            <StatCard
              number="02"
              label="總交易數"
              value={performanceStats.totalTrades}
              icon={<Activity className="h-5 w-5 mx-auto" />}
              theme="signals"
            />
            <StatCard
              number="03"
              label="平均持有"
              value={`${performanceStats.avgHoldingDays}天`}
              icon={<Calendar className="h-5 w-5 mx-auto" />}
              theme="default"
            />
            <StatCard
              number="04"
              label="最大回撤"
              value={`${performanceStats.maxDrawdown}%`}
              icon={<Percent className="h-5 w-5 mx-auto" />}
              theme="destructive"
            />
          </div>
        </section>

        {/* Win Rate Progress */}
        <FeatureCard theme="signals" className="p-5">
          <div className="flex justify-between items-center mb-3">
            <span className="font-medium flex items-center gap-2">
              <Target className="h-4 w-4 text-signals-accent" />
              勝率表現
            </span>
            <span className="text-xl font-bold text-signals-accent">{performanceStats.winRate}%</span>
          </div>
          <GlowProgress value={performanceStats.winRate} theme="signals" size="lg" />
        </FeatureCard>

        {/* Detailed Stats */}
        <section>
          <SectionHeader
            number="02"
            tag="進階分析"
            title="進階指標"
            theme="signals"
            className="mb-4"
          />
          
          <FeatureCard theme="signals" className="divide-y divide-foreground/[0.08]">
            <div className="flex justify-between items-center p-4">
              <span className="text-sm text-muted-foreground">夏普比率</span>
              <span className="font-bold text-lg">{performanceStats.sharpeRatio}</span>
            </div>
            <div className="flex justify-between items-center p-4">
              <span className="text-sm text-muted-foreground">獲利因子</span>
              <span className="font-bold text-lg">{performanceStats.profitFactor}</span>
            </div>
            <div className="flex justify-between items-center p-4">
              <span className="text-sm text-muted-foreground">平均獲利</span>
              <span className="font-bold text-lg text-success drop-shadow-[0_0_6px_hsl(var(--success)/0.5)]">
                +{performanceStats.avgWin}%
              </span>
            </div>
            <div className="flex justify-between items-center p-4">
              <span className="text-sm text-muted-foreground">平均虧損</span>
              <span className="font-bold text-lg text-destructive">
                {performanceStats.avgLoss}%
              </span>
            </div>
          </FeatureCard>
        </section>

        {/* Monthly Returns - Gaming Bar Chart */}
        <section>
          <SectionHeader
            number="03"
            tag="月度表現"
            title="月度報酬"
            icon={<Calendar className="h-3.5 w-3.5" />}
            theme="signals"
            className="mb-4"
          />
          
          <FeatureCard theme="signals" className="p-5">
            <div className="flex items-end gap-2 h-36">
              {monthlyReturns.map((item) => {
                const height = (Math.abs(item.return) / maxReturn) * 100;
                return (
                  <div key={item.month} className="flex-1 flex flex-col items-center gap-1.5">
                    <div className="flex-1 w-full flex items-end justify-center">
                      <div 
                        className={cn(
                          "w-full max-w-8 rounded-t transition-all",
                          item.return >= 0 
                            ? "bg-gradient-to-t from-success to-success/80 shadow-[0_0_10px_-2px_hsl(var(--success)/0.5)]" 
                            : "bg-gradient-to-t from-destructive to-destructive/80 shadow-[0_0_10px_-2px_hsl(var(--destructive)/0.5)]"
                        )}
                        style={{ height: `${height}%`, minHeight: '4px' }}
                      />
                    </div>
                    <span className={cn(
                      "text-xs font-bold",
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
          </FeatureCard>
        </section>

        {/* Recent Trades */}
        <section>
          <SectionHeader
            number="04"
            tag="交易紀錄"
            title="近期已結算交易"
            theme="signals"
            className="mb-4"
          />
          
          <FeatureCard theme="signals" className="divide-y divide-foreground/[0.08]">
            {recentTrades.map((trade, index) => (
              <div key={index} className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium">{trade.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono bg-foreground/[0.05] px-1 py-0.5 rounded mr-1">
                      {trade.symbol}
                    </span>
                    · {trade.date}
                  </p>
                </div>
                <div className={cn(
                  "flex items-center gap-1 font-bold text-lg",
                  trade.pnl >= 0 ? "text-success" : "text-destructive"
                )}>
                  {trade.pnl >= 0 ? (
                    <ArrowUpRight className="h-5 w-5" />
                  ) : (
                    <ArrowDownRight className="h-5 w-5" />
                  )}
                  <span className={cn(
                    trade.pnl >= 0 && "drop-shadow-[0_0_6px_hsl(var(--success)/0.5)]"
                  )}>
                    {trade.pnl > 0 ? '+' : ''}{trade.pnl}%
                  </span>
                </div>
              </div>
            ))}
          </FeatureCard>
        </section>
      </div>
    </UnifiedAppLayout>
  );
}
