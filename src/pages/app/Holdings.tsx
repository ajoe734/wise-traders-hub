import { Link } from 'react-router-dom';
import { SignalsLayout } from '@/components/layouts/SignalsLayout';
import { Badge } from '@/components/ui/badge';
import { SectionHeader } from '@/components/ui/section-header';
import { StatCard } from '@/components/ui/stat-card';
import { FeatureCard } from '@/components/ui/feature-card';
import { GlowProgress } from '@/components/ui/glow-progress';
import { 
  Briefcase, 
  ArrowUpRight, 
  ArrowDownRight, 
  TrendingUp,
  ChevronRight,
  Calendar,
  PieChart,
  Wallet,
  BarChart2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { getUserSubscriptions } from '@/data/mockData';
import { PlanType } from '@/types';

// Mock holdings data
const mockHoldings = [
  { 
    symbol: '3443.TW', 
    name: '創意', 
    buyPrice: 1380, 
    currentPrice: 1420, 
    quantity: 2, 
    pnlPct: 2.9,
    pnlAmount: 80,
    buyDate: '2025-01-02',
    advisor: '趙彭博',
    status: 'holding'
  },
  { 
    symbol: '6770.TW', 
    name: '力積電', 
    buyPrice: 42.5, 
    currentPrice: 43.5, 
    quantity: 10, 
    pnlPct: 2.35,
    pnlAmount: 10,
    buyDate: '2025-01-03',
    advisor: '趙彭博',
    status: 'holding'
  },
  { 
    symbol: '3661.TW', 
    name: '世芯-KY', 
    buyPrice: 1850, 
    currentPrice: 1920, 
    quantity: 1, 
    pnlPct: 3.78,
    pnlAmount: 70,
    buyDate: '2024-12-28',
    advisor: '趙彭博',
    status: 'holding'
  },
  { 
    symbol: '2330.TW', 
    name: '台積電', 
    buyPrice: 580, 
    currentPrice: 595, 
    quantity: 5, 
    pnlPct: 2.59,
    pnlAmount: 75,
    buyDate: '2024-12-20',
    advisor: '陳建宏',
    status: 'holding'
  },
];

// Portfolio summary
const portfolioSummary = {
  totalValue: 125800,
  totalCost: 120350,
  totalPnl: 5450,
  totalPnlPct: 4.53,
  holdingsCount: 4,
  cashBalance: 74200,
  totalAssets: 200000,
};

export default function Holdings() {
  const { user } = useAuth();
  const subscriptions = user ? getUserSubscriptions(user.id) : [];
  
  const advisorSubs = subscriptions.filter(s => 
    s.plan.planType === PlanType.ANALYST_SIGNAL_L1 || 
    s.plan.planType === PlanType.ANALYST_SIGNAL_DIAG_L2
  );

  // Group holdings by advisor
  const holdingsByAdvisor = mockHoldings.reduce((acc, holding) => {
    if (!acc[holding.advisor]) {
      acc[holding.advisor] = [];
    }
    acc[holding.advisor].push(holding);
    return acc;
  }, {} as Record<string, typeof mockHoldings>);

  const stockPercentage = (portfolioSummary.totalValue / portfolioSummary.totalAssets) * 100;
  const cashPercentage = (portfolioSummary.cashBalance / portfolioSummary.totalAssets) * 100;

  return (
    <SignalsLayout>
      <div className="p-4 space-y-6 max-w-lg mx-auto pb-24">
        {/* Header */}
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-signals-accent to-signals-accent/70 flex items-center justify-center shadow-[0_0_20px_-5px_hsl(var(--signals-accent)/0.5)]">
                <Briefcase className="h-6 w-6 text-white" />
              </div>
            </div>
            <div>
              <p className="text-xs text-signals-accent font-semibold tracking-wider uppercase">持倉總覽</p>
              <h1 className="text-xl font-bold">我的持倉</h1>
            </div>
          </div>
        </div>

        {/* Portfolio Summary - Dramatic Card */}
        <FeatureCard theme="signals" variant="highlight" className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <PieChart className="h-5 w-5 text-signals-accent" />
            <span className="font-semibold">投資組合總覽</span>
          </div>

          {/* Total Value with Glow */}
          <div className="flex items-end justify-between mb-5">
            <div>
              <p className="text-sm text-muted-foreground">持股總市值</p>
              <p className="text-3xl font-bold drop-shadow-[0_0_10px_hsl(var(--foreground)/0.1)]">
                ${portfolioSummary.totalValue.toLocaleString()}
              </p>
            </div>
            <div className={cn(
              "text-right",
              portfolioSummary.totalPnlPct >= 0 ? "text-success" : "text-destructive"
            )}>
              <div className="flex items-center gap-1 justify-end text-xl font-bold">
                {portfolioSummary.totalPnlPct >= 0 ? (
                  <ArrowUpRight className="h-5 w-5" />
                ) : (
                  <ArrowDownRight className="h-5 w-5" />
                )}
                <span className={cn(
                  portfolioSummary.totalPnlPct >= 0 && "drop-shadow-[0_0_8px_hsl(var(--success)/0.6)]"
                )}>
                  {portfolioSummary.totalPnlPct >= 0 ? '+' : ''}{portfolioSummary.totalPnlPct.toFixed(2)}%
                </span>
              </div>
              <p className="text-sm">
                {portfolioSummary.totalPnl >= 0 ? '+' : ''}${portfolioSummary.totalPnl.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Asset Allocation - HP Bar Style */}
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Wallet className="h-4 w-4" />
                資產配置
              </span>
              <span className="font-medium">總資產 ${portfolioSummary.totalAssets.toLocaleString()}</span>
            </div>
            
            <div className="hp-bar">
              <div className="flex h-full">
                <div 
                  className="h-full bg-gradient-to-b from-signals-accent to-signals-accent/80 shadow-[0_0_10px_hsl(var(--signals-accent)/0.5)]"
                  style={{ width: `${stockPercentage}%` }}
                />
                <div 
                  className="h-full bg-gradient-to-b from-muted-foreground/40 to-muted-foreground/30"
                  style={{ width: `${cashPercentage}%` }}
                />
              </div>
            </div>
            
            <div className="flex justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-signals-accent shadow-[0_0_6px_hsl(var(--signals-accent)/0.5)]" />
                持股 {stockPercentage.toFixed(0)}%
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/40" />
                現金 {cashPercentage.toFixed(0)}%
              </span>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-3 mt-5 pt-5 border-t border-foreground/[0.08]">
            <div className="relative text-center p-2 rounded-lg bg-foreground/[0.03]">
              <span className="absolute -top-1 left-1 text-2xl font-bold opacity-[0.06] text-signals-accent">4</span>
              <p className="text-xs text-muted-foreground">持股數</p>
              <p className="text-lg font-bold">{portfolioSummary.holdingsCount}</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-foreground/[0.03]">
              <p className="text-xs text-muted-foreground">成本</p>
              <p className="text-lg font-bold">${(portfolioSummary.totalCost / 1000).toFixed(0)}K</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-foreground/[0.03]">
              <p className="text-xs text-muted-foreground">現金</p>
              <p className="text-lg font-bold">${(portfolioSummary.cashBalance / 1000).toFixed(0)}K</p>
            </div>
          </div>
        </FeatureCard>

        {/* Holdings by Advisor */}
        {Object.entries(holdingsByAdvisor).map(([advisor, holdings], groupIndex) => (
          <section key={advisor} className="space-y-3">
            <SectionHeader
              number={String(groupIndex + 1).padStart(2, '0')}
              tag={advisor}
              title={`${advisor} 的訊號`}
              theme="signals"
            />
            <Badge variant="outline" className="text-xs -mt-6 ml-auto block w-fit">
              {holdings.length} 檔
            </Badge>
            
            <FeatureCard theme="signals" className="divide-y divide-foreground/[0.08]">
              {holdings.map((holding) => (
                <div key={holding.symbol} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold">{holding.name}</span>
                        <span className="text-xs text-muted-foreground font-mono bg-foreground/[0.05] px-1.5 py-0.5 rounded">
                          {holding.symbol}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {holding.buyDate}
                        </span>
                        <span>{holding.quantity} 股</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={cn(
                        "font-bold flex items-center gap-1 justify-end",
                        holding.pnlPct >= 0 ? "text-success" : "text-destructive"
                      )}>
                        {holding.pnlPct >= 0 ? (
                          <ArrowUpRight className="h-4 w-4" />
                        ) : (
                          <ArrowDownRight className="h-4 w-4" />
                        )}
                        <span className={cn(
                          holding.pnlPct >= 0 && "drop-shadow-[0_0_6px_hsl(var(--success)/0.6)]"
                        )}>
                          {holding.pnlPct >= 0 ? '+' : ''}{holding.pnlPct.toFixed(2)}%
                        </span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        ${holding.currentPrice} 
                        <span className="text-xs ml-1">
                          ({holding.pnlAmount >= 0 ? '+' : ''}{holding.pnlAmount})
                        </span>
                      </p>
                    </div>
                  </div>
                  
                  {/* Price Progress - Gaming Style */}
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground w-12">${holding.buyPrice}</span>
                    <div className="flex-1">
                      <GlowProgress 
                        value={((holding.currentPrice - holding.buyPrice) / holding.buyPrice) * 100 + 50}
                        max={100}
                        theme={holding.pnlPct >= 0 ? "success" : "default"}
                        size="sm"
                      />
                    </div>
                    <span className="text-muted-foreground w-12 text-right">${(holding.buyPrice * 1.1).toFixed(0)}</span>
                  </div>
                </div>
              ))}
            </FeatureCard>
          </section>
        ))}

        {/* Empty State */}
        {mockHoldings.length === 0 && (
          <FeatureCard theme="signals" className="p-8 text-center">
            <Briefcase className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground mb-2">目前沒有持倉</p>
            <p className="text-sm text-muted-foreground">跟隨分析師訊號開始建倉吧！</p>
          </FeatureCard>
        )}

        {/* Quick Links */}
        <section className="space-y-2 pt-2">
          <Link 
            to="/app/performance"
            className="flex items-center justify-between p-4 rounded-xl bg-foreground/[0.03] border border-foreground/[0.08] hover:bg-foreground/[0.06] transition-colors"
          >
            <span className="text-sm flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-signals-accent" />
              查看完整績效報告
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </section>
      </div>
    </SignalsLayout>
  );
}
