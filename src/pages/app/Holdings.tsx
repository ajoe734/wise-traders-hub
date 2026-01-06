import { Link } from 'react-router-dom';
import { SignalsLayout } from '@/components/layouts/SignalsLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { 
  Briefcase, 
  ArrowUpRight, 
  ArrowDownRight, 
  TrendingUp,
  ChevronRight,
  Calendar,
  DollarSign,
  Percent,
  PieChart
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

  return (
    <SignalsLayout>
      <div className="p-4 space-y-6 max-w-lg mx-auto pb-24">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-signals-accent" />
              我的持倉
            </h1>
            <p className="text-sm text-muted-foreground mt-1">追蹤你的跟單績效</p>
          </div>
        </div>

        {/* Portfolio Summary */}
        <Card className="border-signals-accent/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <PieChart className="h-4 w-4 text-signals-accent" />
              投資組合總覽
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Total Value */}
            <div className="flex items-end justify-between">
              <div>
                <p className="text-sm text-muted-foreground">持股總市值</p>
                <p className="text-2xl font-bold">
                  ${portfolioSummary.totalValue.toLocaleString()}
                </p>
              </div>
              <div className={cn(
                "text-right",
                portfolioSummary.totalPnlPct >= 0 ? "text-success" : "text-destructive"
              )}>
                <div className="flex items-center gap-1 justify-end text-lg font-semibold">
                  {portfolioSummary.totalPnlPct >= 0 ? (
                    <ArrowUpRight className="h-4 w-4" />
                  ) : (
                    <ArrowDownRight className="h-4 w-4" />
                  )}
                  {portfolioSummary.totalPnlPct >= 0 ? '+' : ''}{portfolioSummary.totalPnlPct.toFixed(2)}%
                </div>
                <p className="text-sm">
                  {portfolioSummary.totalPnl >= 0 ? '+' : ''}${portfolioSummary.totalPnl.toLocaleString()}
                </p>
              </div>
            </div>

            {/* Asset Allocation Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">資產配置</span>
                <span className="font-medium">總資產 ${portfolioSummary.totalAssets.toLocaleString()}</span>
              </div>
              <div className="h-3 rounded-full overflow-hidden flex bg-muted">
                <div 
                  className="bg-signals-accent h-full"
                  style={{ width: `${(portfolioSummary.totalValue / portfolioSummary.totalAssets) * 100}%` }}
                />
                <div 
                  className="bg-muted-foreground/30 h-full"
                  style={{ width: `${(portfolioSummary.cashBalance / portfolioSummary.totalAssets) * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-signals-accent" />
                  持股 {((portfolioSummary.totalValue / portfolioSummary.totalAssets) * 100).toFixed(0)}%
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                  現金 {((portfolioSummary.cashBalance / portfolioSummary.totalAssets) * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-3 pt-2">
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">持股數</p>
                <p className="text-lg font-bold">{portfolioSummary.holdingsCount}</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">成本</p>
                <p className="text-lg font-bold">${(portfolioSummary.totalCost / 1000).toFixed(0)}K</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">現金</p>
                <p className="text-lg font-bold">${(portfolioSummary.cashBalance / 1000).toFixed(0)}K</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Holdings by Advisor */}
        {Object.entries(holdingsByAdvisor).map(([advisor, holdings]) => (
          <section key={advisor} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm text-muted-foreground">{advisor} 的訊號</h2>
              <Badge variant="outline" className="text-xs">
                {holdings.length} 檔
              </Badge>
            </div>
            
            <Card className="divide-y divide-border">
              {holdings.map((holding) => (
                <div key={holding.symbol} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold">{holding.name}</span>
                        <span className="text-xs text-muted-foreground font-mono">{holding.symbol}</span>
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
                        "font-semibold flex items-center gap-1 justify-end",
                        holding.pnlPct >= 0 ? "text-success" : "text-destructive"
                      )}>
                        {holding.pnlPct >= 0 ? (
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowDownRight className="h-3.5 w-3.5" />
                        )}
                        {holding.pnlPct >= 0 ? '+' : ''}{holding.pnlPct.toFixed(2)}%
                      </p>
                      <p className="text-sm text-muted-foreground">
                        ${holding.currentPrice} 
                        <span className="text-xs ml-1">
                          ({holding.pnlAmount >= 0 ? '+' : ''}{holding.pnlAmount})
                        </span>
                      </p>
                    </div>
                  </div>
                  
                  {/* Price Progress */}
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">${holding.buyPrice}</span>
                    <div className="flex-1 relative">
                      <Progress 
                        value={Math.min(100, Math.max(0, ((holding.currentPrice - holding.buyPrice) / holding.buyPrice) * 100 + 50))} 
                        className="h-1.5"
                      />
                    </div>
                    <span className="text-muted-foreground">${(holding.buyPrice * 1.1).toFixed(0)}</span>
                  </div>
                </div>
              ))}
            </Card>
          </section>
        ))}

        {/* Empty State */}
        {mockHoldings.length === 0 && (
          <Card className="bg-muted/30 p-8 text-center">
            <Briefcase className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground mb-2">目前沒有持倉</p>
            <p className="text-sm text-muted-foreground">跟隨分析師訊號開始建倉吧！</p>
          </Card>
        )}

        {/* Quick Links */}
        <div className="space-y-2 pt-2">
          <Link 
            to="/app/performance"
            className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
          >
            <span className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-signals-accent" />
              查看完整績效報告
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </div>
      </div>
    </SignalsLayout>
  );
}
