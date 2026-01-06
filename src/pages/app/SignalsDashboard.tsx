import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
import { useAuth } from '@/contexts/AuthContext';
import { getUserSubscriptions, getSignalsForUser } from '@/data/mockData';
import { PlanType, SignalAction, SubscriptionWithDetails, SignalWithPerson } from '@/types';
import { 
  Radio, 
  Target, 
  TrendingUp, 
  ChevronRight,
  Flame,
  BarChart3,
  History,
  Briefcase,
  ArrowUpRight,
  ArrowDownRight,
  Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, isToday, differenceInMinutes } from 'date-fns';
import { zhTW } from 'date-fns/locale';

// Mock holdings data for demo
const mockHoldings = [
  { symbol: '3443.TW', name: '創意', buyPrice: 1380, currentPrice: 1420, quantity: 2, pnlPct: 2.9 },
  { symbol: '6770.TW', name: '力積電', buyPrice: 42.5, currentPrice: 43.5, quantity: 10, pnlPct: 2.35 },
  { symbol: '3661.TW', name: '世芯-KY', buyPrice: 1850, currentPrice: 1920, quantity: 1, pnlPct: 3.78 },
];

// Mock weekly stats
const mockWeeklyStats = {
  totalSignals: 8,
  winRate: 75,
  avgReturn: 4.2,
  totalPnl: 12800,
};

interface SignalsDashboardProps {
  subscriptions: SubscriptionWithDetails[];
  userName?: string;
}

export function SignalsDashboard({ subscriptions, userName }: SignalsDashboardProps) {
  const { user } = useAuth();
  
  // Get all signals from subscribed advisors
  const allSignals = user ? getSignalsForUser(user.id) : [];
  const advisorSignals = allSignals.filter(s => 
    s.system && 
    (s.planType === PlanType.ANALYST_SIGNAL_L1 || s.planType === PlanType.ANALYST_SIGNAL_DIAG_L2)
  );
  
  // Today's signals
  const todaySignals = advisorSignals.filter(s => isToday(s.timeTrade));
  const latestSignals = advisorSignals.slice(0, 5);
  
  // Primary advisor for quick links
  const primarySub = subscriptions[0];

  const getActionColor = (action: SignalAction) => {
    switch (action) {
      case SignalAction.BUY:
      case SignalAction.ADD:
        return 'text-success';
      case SignalAction.SELL:
      case SignalAction.TRIM:
      case SignalAction.EXIT:
        return 'text-destructive';
      default:
        return 'text-foreground';
    }
  };

  const getActionLabel = (action: SignalAction) => {
    switch (action) {
      case SignalAction.BUY: return '買進';
      case SignalAction.ADD: return '加碼';
      case SignalAction.SELL: return '賣出';
      case SignalAction.TRIM: return '減碼';
      case SignalAction.EXIT: return '出場';
      default: return action;
    }
  };

  const getTimeLabel = (date: Date) => {
    const mins = differenceInMinutes(new Date(), date);
    if (mins < 60) return `${mins} 分鐘前`;
    if (mins < 1440) return format(date, 'HH:mm');
    return format(date, 'MM/dd');
  };

  return (
    <div className="p-4 space-y-6 max-w-lg mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Target className="h-5 w-5 text-advisor" />
            <span className="text-sm font-medium text-advisor">跟單派</span>
          </div>
          <h1 className="text-xl font-bold">戰情室</h1>
        </div>
        <Link 
          to="/app" 
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          切換模式
        </Link>
      </div>

      {/* Status Overview */}
      <section className="animate-fade-in">
        <div className="grid grid-cols-3 gap-3">
          <Card className="border-advisor/20">
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">今日訊號</p>
              <p className="text-2xl font-bold text-advisor">
                {todaySignals.length}
              </p>
              <p className="text-xs text-muted-foreground">筆</p>
            </CardContent>
          </Card>
          <Card className="border-advisor/20">
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">持倉</p>
              <p className="text-2xl font-bold">
                {mockHoldings.length}
              </p>
              <p className="text-xs text-muted-foreground">檔</p>
            </CardContent>
          </Card>
          <Card className="border-advisor/20">
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">本週績效</p>
              <p className={cn(
                "text-2xl font-bold",
                mockWeeklyStats.avgReturn >= 0 ? "text-success" : "text-destructive"
              )}>
                +{mockWeeklyStats.avgReturn}%
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Latest Signals */}
      <section className="animate-slide-up">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Radio className="h-4 w-4 text-advisor" />
            最新訊號
          </h2>
          <Link 
            to={`/line/${primarySub?.person.slug}/signals`} 
            className="text-sm text-advisor flex items-center gap-1"
          >
            查看全部
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        
        {latestSignals.length > 0 ? (
          <div className="space-y-2">
            {latestSignals.map(signal => (
              <Link 
                key={signal.id} 
                to={`/line/${signal.person.slug}/signal/${signal.id}`}
              >
                <Card variant="interactive" className="p-3 border-l-4 border-l-advisor/50 hover:border-l-advisor">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge 
                          variant={signal.action === SignalAction.BUY || signal.action === SignalAction.ADD ? 'advisor' : 'outline'}
                          className="text-xs"
                        >
                          {getActionLabel(signal.action)}
                        </Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {getTimeLabel(signal.timeTrade)}
                        </span>
                      </div>
                      <p className="font-semibold truncate">{signal.instrument}</p>
                      <p className="text-sm text-muted-foreground line-clamp-1">
                        {signal.reasonSummary}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <img 
                          src={signal.person.avatarUrl || '/placeholder.svg'} 
                          alt={signal.person.name}
                          className="h-4 w-4 rounded-full"
                        />
                        <span className="text-xs text-muted-foreground">{signal.person.name}</span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="bg-muted/30 p-6 text-center">
            <Radio className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">今日暫無新訊號</p>
            <p className="text-sm text-muted-foreground mt-1">訊號發出時會即時通知你</p>
          </Card>
        )}
      </section>

      {/* My Holdings */}
      <section className="animate-slide-up" style={{ animationDelay: '0.1s' }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-advisor" />
            我的持倉
          </h2>
          <Link 
            to={`/line/${primarySub?.person.slug}/trades`}
            className="text-sm text-advisor flex items-center gap-1"
          >
            詳細
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        
        {mockHoldings.length > 0 ? (
          <Card className="divide-y divide-border">
            {mockHoldings.map((holding, index) => (
              <div key={holding.symbol} className="p-3 flex items-center justify-between">
                <div>
                  <p className="font-medium">{holding.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{holding.symbol}</p>
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
                  <p className="text-xs text-muted-foreground">
                    ${holding.currentPrice}
                  </p>
                </div>
              </div>
            ))}
          </Card>
        ) : (
          <Card className="bg-muted/30 p-6 text-center">
            <Briefcase className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">目前沒有持倉</p>
          </Card>
        )}
      </section>

      {/* Weekly Stats */}
      <section className="animate-slide-up" style={{ animationDelay: '0.15s' }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-advisor" />
            本週戰績
          </h2>
          <Link 
            to={`/line/${primarySub?.person.slug}/performance`}
            className="text-sm text-advisor flex items-center gap-1"
          >
            完整績效
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        
        <Card className="border-advisor/20">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground mb-1">訊號數</p>
                <p className="text-xl font-bold">{mockWeeklyStats.totalSignals}</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground mb-1">勝率</p>
                <p className="text-xl font-bold">{mockWeeklyStats.winRate}%</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-success/10">
                <p className="text-xs text-muted-foreground mb-1">平均獲利</p>
                <p className="text-xl font-bold text-success">+{mockWeeklyStats.avgReturn}%</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-success/10">
                <p className="text-xs text-muted-foreground mb-1">累計損益</p>
                <p className="text-xl font-bold text-success">
                  +${mockWeeklyStats.totalPnl.toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* My Advisors */}
      <section className="animate-slide-up" style={{ animationDelay: '0.2s' }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Flame className="h-4 w-4 text-advisor" />
            我的分析師
          </h2>
        </div>
        
        <div className="space-y-2">
          {subscriptions.map(sub => (
            <Link key={sub.id} to={`/line/${sub.person.slug}/home`}>
              <Card variant="interactive" className="p-3">
                <div className="flex items-center gap-3">
                  <img 
                    src={sub.person.avatarUrl || '/placeholder.svg'} 
                    alt={sub.person.name}
                    className="h-10 w-10 rounded-full object-cover"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{sub.person.name}</span>
                      <RoleBadge role={sub.person.role} size="sm" />
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {sub.plan.name}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Quick Links */}
      <section className="pt-2 space-y-2 animate-fade-in" style={{ animationDelay: '0.25s' }}>
        <Link 
          to="/account/subscriptions" 
          className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
        >
          <span className="text-sm text-muted-foreground">管理訂閱</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link 
          to="/experts" 
          className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
        >
          <span className="text-sm text-muted-foreground">探索更多專家</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </section>
    </div>
  );
}

export default SignalsDashboard;
