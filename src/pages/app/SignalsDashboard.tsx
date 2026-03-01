import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
import { SectionHeader } from '@/components/ui/section-header';
import { StatCard } from '@/components/ui/stat-card';
import { FeatureCard } from '@/components/ui/feature-card';
import { GlowProgress } from '@/components/ui/glow-progress';
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
  Briefcase,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Zap,
  Trophy
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
      {/* Header with dramatic styling */}
      <div className="relative">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-signals-accent to-signals-accent/70 flex items-center justify-center shadow-[0_0_20px_-5px_hsl(var(--signals-accent)/0.5)]">
              <Target className="h-6 w-6 text-white" />
            </div>
            <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-success animate-pulse" />
          </div>
          <div>
            <p className="text-xs text-signals-accent font-semibold tracking-wider uppercase">跟單派 · SIGNALS</p>
            <h1 className="text-xl font-bold">今日戰況，盡在掌握</h1>
          </div>
        </div>
      </div>

      {/* Status Overview - Dramatic Cards */}
      <section className="animate-fade-in">
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            number="01"
            label="今日訊號"
            value={todaySignals.length}
            sublabel="筆"
            theme="signals"
            glowing={todaySignals.length > 0}
          />
          <StatCard
            number="02"
            label="持倉"
            value={mockHoldings.length}
            sublabel="檔"
            theme="signals"
          />
          <StatCard
            number="03"
            label="本週績效"
            value={`+${mockWeeklyStats.avgReturn}%`}
            theme="success"
            glowing
          />
        </div>
      </section>

      {/* Latest Signals */}
      <section className="animate-slide-up">
        <SectionHeader
          number="01"
          tag="即時訊號"
          title="最新訊號"
          icon={<Radio className="h-3.5 w-3.5" />}
          theme="signals"
          className="mb-4"
        />
        <div className="flex items-center justify-end -mt-8 mb-3">
          <Link 
            to="/app/signals" 
            className="text-sm text-signals-accent flex items-center gap-1 hover:underline"
          >
            查看全部
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        
        {latestSignals.length > 0 ? (
          <div className="space-y-2">
            {latestSignals.map((signal, index) => (
              <Link 
                key={signal.id} 
                to={`/app/signal/${signal.id}`}
              >
                <FeatureCard theme="signals" className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
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
                      <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">
                        {signal.reasonSummary}
                      </p>
                      <div className="flex items-center gap-1.5 mt-2">
                        <img 
                          src={signal.person.avatarUrl || '/placeholder.svg'} 
                          alt={signal.person.name}
                          className="h-5 w-5 rounded-full border border-signals-accent/30"
                        />
                        <span className="text-xs text-muted-foreground">{signal.person.name}</span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                  </div>
                </FeatureCard>
              </Link>
            ))}
          </div>
        ) : (
          <FeatureCard theme="signals" className="p-6 text-center">
            <Radio className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">今日暫無新訊號</p>
            <p className="text-sm text-muted-foreground mt-1">訊號發出時會即時通知你</p>
          </FeatureCard>
        )}
      </section>

      {/* My Holdings */}
      <section className="animate-slide-up" style={{ animationDelay: '0.1s' }}>
        <SectionHeader
          number="02"
          tag="持股狀況"
          title="我的持倉"
          icon={<Briefcase className="h-3.5 w-3.5" />}
          theme="signals"
          className="mb-4"
        />
        <div className="flex items-center justify-end -mt-8 mb-3">
          <Link 
            to="/app/holdings"
            className="text-sm text-signals-accent flex items-center gap-1 hover:underline"
          >
            詳細
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        
        {mockHoldings.length > 0 ? (
          <FeatureCard theme="signals" className="divide-y divide-foreground/[0.08]">
            {mockHoldings.map((holding) => (
              <div key={holding.symbol} className="p-4 flex items-center justify-between">
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
                    <span className={cn(
                      holding.pnlPct >= 0 && "drop-shadow-[0_0_6px_hsl(var(--success)/0.6)]"
                    )}>
                      {holding.pnlPct >= 0 ? '+' : ''}{holding.pnlPct.toFixed(2)}%
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ${holding.currentPrice}
                  </p>
                </div>
              </div>
            ))}
          </FeatureCard>
        ) : (
          <FeatureCard theme="signals" className="p-6 text-center">
            <Briefcase className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">目前沒有持倉</p>
          </FeatureCard>
        )}
      </section>

      {/* Weekly Stats - Gaming Style */}
      <section className="animate-slide-up" style={{ animationDelay: '0.15s' }}>
        <SectionHeader
          number="03"
          tag="戰績總覽"
          title="本週戰績"
          icon={<Trophy className="h-3.5 w-3.5" />}
          theme="signals"
          className="mb-4"
        />
        <div className="flex items-center justify-end -mt-8 mb-3">
          <Link 
            to="/app/performance"
            className="text-sm text-signals-accent flex items-center gap-1 hover:underline"
          >
            完整績效
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        
        <FeatureCard theme="signals" variant="highlight" className="p-5">
          {/* Win Rate HP Bar */}
          <div className="mb-5">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium flex items-center gap-1.5">
                <Zap className="h-4 w-4 text-signals-accent" />
                勝率
              </span>
              <span className="text-lg font-bold text-signals-accent">{mockWeeklyStats.winRate}%</span>
            </div>
            <GlowProgress value={mockWeeklyStats.winRate} theme="signals" size="lg" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="relative p-3 rounded-lg bg-foreground/[0.03] border border-foreground/[0.05]">
              <span className="number-decoration text-signals-accent">8</span>
              <p className="text-xs text-muted-foreground relative z-10">訊號數</p>
              <p className="text-xl font-bold relative z-10">{mockWeeklyStats.totalSignals}</p>
            </div>
            <div className="relative p-3 rounded-lg bg-success/10 border border-success/20">
              <p className="text-xs text-muted-foreground">平均獲利</p>
              <p className="text-xl font-bold text-success drop-shadow-[0_0_8px_hsl(var(--success)/0.5)]">
                +{mockWeeklyStats.avgReturn}%
              </p>
            </div>
          </div>

          <div className="mt-3 p-3 rounded-lg bg-success/10 border border-success/20 text-center">
            <p className="text-xs text-muted-foreground">累計損益</p>
            <p className="text-2xl font-bold text-success drop-shadow-[0_0_10px_hsl(var(--success)/0.6)]">
              +${mockWeeklyStats.totalPnl.toLocaleString()}
            </p>
          </div>
        </FeatureCard>
      </section>

      {/* My Advisors */}
      <section className="animate-slide-up" style={{ animationDelay: '0.2s' }}>
        <SectionHeader
          tag="訂閱中"
          title="我的分析師"
          icon={<Flame className="h-3.5 w-3.5" />}
          theme="signals"
          className="mb-4"
        />
        
        <div className="space-y-2">
          {subscriptions.map(sub => (
            <Link key={sub.id} to={`/expert/${sub.person.slug}`}>
              <FeatureCard theme="signals" className="p-4">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <img 
                      src={sub.person.avatarUrl || '/placeholder.svg'} 
                      alt={sub.person.name}
                      className="h-12 w-12 rounded-full object-cover border-2 border-signals-accent/30"
                    />
                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-success border-2 border-background flex items-center justify-center">
                      <Zap className="h-2.5 w-2.5 text-white" />
                    </div>
                  </div>
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
              </FeatureCard>
            </Link>
          ))}
        </div>
      </section>

      {/* Quick Links */}
      <section className="pt-2 space-y-2 animate-fade-in" style={{ animationDelay: '0.25s' }}>
        <Link 
          to="/app/account" 
          className="flex items-center justify-between p-4 rounded-xl bg-foreground/[0.03] border border-foreground/[0.08] hover:bg-foreground/[0.06] transition-colors"
        >
          <span className="text-sm text-muted-foreground">管理訂閱</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link 
          to="/experts" 
          className="flex items-center justify-between p-4 rounded-xl bg-foreground/[0.03] border border-foreground/[0.08] hover:bg-foreground/[0.06] transition-colors"
        >
          <span className="text-sm text-muted-foreground">探索更多專家</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </section>
    </div>
  );
}

export default SignalsDashboard;
