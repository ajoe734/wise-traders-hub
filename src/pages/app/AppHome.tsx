import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SectionHeader } from '@/components/ui/section-header';
import { StatCard } from '@/components/ui/stat-card';
import { FeatureCard } from '@/components/ui/feature-card';

import { UnifiedAppLayout } from '@/components/layouts/UnifiedAppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { getUserSubscriptions, getSignalsForUser, getJournalsForUser } from '@/data/mockData';
import { PlanType, SignalAction } from '@/types';
import { 
  Target, 
  Compass,
  Radio, 
  TrendingUp, 
  ChevronRight,
  Clock,
  BookOpen,
  Lock,
  CheckCircle2,
  BarChart3
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { isToday, differenceInMinutes } from 'date-fns';

// Mock performance data for demo
const mockPerformance: Record<string, { cumulative: number; annualized: number }> = {
  'zhao-advisor': { cumulative: 128.5, annualized: 45.2 },
  'zhao-mentor': { cumulative: 85.2, annualized: 32.1 },
  'chen-advisor': { cumulative: 92.3, annualized: 38.7 },
  'lin-advisor': { cumulative: 45.6, annualized: 18.2 },
};

// Mock holdings data for demo
const mockHoldings = [
  { symbol: '3443.TW', name: '創意', buyPrice: 1380, currentPrice: 1420, quantity: 2, pnlPct: 2.9 },
  { symbol: '6770.TW', name: '力積電', buyPrice: 42.5, currentPrice: 43.5, quantity: 10, pnlPct: 2.35 },
];

// Mock weekly stats
const mockWeeklyStats = {
  totalSignals: 8,
  winRate: 75,
  avgReturn: 4.2,
};


const AppHome = () => {
  const { user } = useAuth();
  const subscriptions = user ? getUserSubscriptions(user.id) : [];
  
  // Filter subscriptions by type
  const advisorSubs = subscriptions.filter(s => 
    s.plan.planType === PlanType.ANALYST_SIGNAL_L1 || 
    s.plan.planType === PlanType.ANALYST_SIGNAL_DIAG_L2
  );
  const mentorSubs = subscriptions.filter(s => 
    s.plan.planType === PlanType.MENTOR_WEEKLY_JOURNAL
  );

  const hasAdvisor = advisorSubs.length > 0;
  const hasMentor = mentorSubs.length > 0;

  // Get signals for advisor subscribers
  const allSignals = user ? getSignalsForUser(user.id) : [];
  const advisorSignals = allSignals.filter(s => 
    s.system && 
    (s.planType === PlanType.ANALYST_SIGNAL_L1 || s.planType === PlanType.ANALYST_SIGNAL_DIAG_L2)
  );
  const todaySignals = advisorSignals.filter(s => isToday(s.timeTrade));
  const latestSignal = advisorSignals[0];

  // Get journals for mentor subscribers
  const journals = user ? getJournalsForUser(user.id) : [];
  const latestJournal = journals[0];

  const getTimeLabel = (date: Date) => {
    const mins = differenceInMinutes(new Date(), date);
    if (mins < 60) return `${mins} 分鐘前`;
    return `${Math.floor(mins / 60)} 小時前`;
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

  return (
    <UnifiedAppLayout>
      <div className="p-4 space-y-6 max-w-lg mx-auto pb-24">
        {/* Header */}
        <div className="relative animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-[0_0_20px_-5px_hsl(var(--primary)/0.5)]">
                <Target className="h-6 w-6 text-white" />
              </div>
            </div>
            <div>
              <p className="text-xs text-primary font-semibold tracking-wider uppercase">會員戰情室</p>
              <h1 className="text-xl font-bold">
                嗨，{user?.name || '會員'}
              </h1>
            </div>
          </div>
        </div>

        {/* ============ 跟單派區塊 ============ */}
        <section className="animate-slide-up">
          <SectionHeader
            number="01"
            tag={hasAdvisor ? '訂閱中' : '未訂閱'}
            title="跟單派 · SIGNALS"
            icon={<Radio className="h-3.5 w-3.5" />}
            theme="signals"
            className="mb-4"
          />

          {hasAdvisor ? (
            // ✅ 已訂閱跟單派
            <div className="space-y-3">
              {/* Quick Stats */}
              <div className="grid grid-cols-3 gap-2">
                <StatCard
                  label="今日訊號"
                  value={todaySignals.length}
                  sublabel="筆"
                  theme="signals"
                  glowing={todaySignals.length > 0}
                />
                <StatCard
                  label="持倉"
                  value={mockHoldings.length}
                  sublabel="檔"
                  theme="signals"
                />
                <StatCard
                  label="勝率"
                  value={`${mockWeeklyStats.winRate}%`}
                  theme="success"
                />
              </div>

              {/* Latest Signal Preview */}
              {latestSignal && (
                <Link to={`/app/signal/${latestSignal.id}`}>
                  <FeatureCard theme="signals" className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge 
                            variant={latestSignal.action === SignalAction.BUY || latestSignal.action === SignalAction.ADD ? 'advisor' : 'outline'}
                            className="text-xs"
                          >
                            {getActionLabel(latestSignal.action)}
                          </Badge>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {getTimeLabel(latestSignal.timeTrade)}
                          </span>
                        </div>
                        <p className="font-semibold truncate">{latestSignal.instrument}</p>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <img 
                            src={latestSignal.person.avatarUrl || '/placeholder.svg'} 
                            alt={latestSignal.person.name}
                            className="h-5 w-5 rounded-full border border-signals-accent/30"
                          />
                          <span className="text-xs text-muted-foreground">{latestSignal.person.name}</span>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                    </div>
                  </FeatureCard>
                </Link>
              )}

              {/* Teacher Performance Summary */}
              <FeatureCard theme="signals" className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="h-4 w-4 text-signals-accent" />
                  <span className="text-sm font-medium">老師績效</span>
                </div>
                <div className="space-y-2">
                  {advisorSubs.map(sub => {
                    const perf = mockPerformance[sub.person.slug] || { cumulative: 0, annualized: 0 };
                    return (
                      <Link 
                        key={sub.id} 
                        to={`/line/${sub.person.slug}/performance`}
                        className="flex items-center justify-between py-1.5 hover:bg-foreground/5 rounded-lg px-2 -mx-2 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7 border border-signals-accent/30">
                            <AvatarImage src={sub.person.avatarUrl} alt={sub.person.name} />
                            <AvatarFallback className="text-xs">{sub.person.name[0]}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm">{sub.person.name}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className={cn(
                            "font-medium",
                            perf.cumulative >= 0 ? "text-success" : "text-destructive"
                          )}>
                            累積 {perf.cumulative >= 0 ? '+' : ''}{perf.cumulative}%
                          </span>
                          <span className="text-muted-foreground">
                            年化 {perf.annualized >= 0 ? '+' : ''}{perf.annualized}%
                          </span>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </FeatureCard>

              {/* Subscribed Advisors & CTA */}
              <div className="flex items-center gap-2">
                {advisorSubs.slice(0, 3).map(sub => (
                  <Link key={sub.id} to={`/expert/${sub.person.slug}`}>
                    <Avatar className="h-10 w-10 border-2 border-signals-accent/40">
                      <AvatarImage src={sub.person.avatarUrl} alt={sub.person.name} />
                      <AvatarFallback>{sub.person.name[0]}</AvatarFallback>
                    </Avatar>
                  </Link>
                ))}
                <Link 
                  to="/app/signals" 
                  className="ml-auto text-sm text-signals-accent flex items-center gap-1 hover:underline"
                >
                  進入訊號中心
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          ) : (
            // ❌ 未訂閱跟單派
            <FeatureCard theme="signals" variant="highlight" className="p-5">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl bg-signals-accent/10 flex items-center justify-center flex-shrink-0">
                  <Lock className="h-6 w-6 text-signals-accent/60" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">解鎖跟單功能</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    即時跟單，讓專業分析師帶你操作
                  </p>
                  <ul className="text-xs text-muted-foreground space-y-1 mb-4">
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-signals-accent" />
                      即時買賣訊號通知
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-signals-accent" />
                      持倉管理與績效追蹤
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-signals-accent" />
                      分析師操作邏輯解說
                    </li>
                  </ul>
                  <Button asChild variant="advisor" size="sm" className="w-full">
                    <Link to="/experts">
                      探索分析師
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Link>
                  </Button>
                </div>
              </div>
            </FeatureCard>
          )}
        </section>

        {/* ============ 修煉派區塊 ============ */}
        <section className="animate-slide-up" style={{ animationDelay: '0.1s' }}>
          <SectionHeader
            number="02"
            tag={hasMentor ? '訂閱中' : '未訂閱'}
            title="修煉派 · LEARNING"
            icon={<Compass className="h-3.5 w-3.5" />}
            theme="learning"
            className="mb-4"
          />

          {hasMentor ? (
            // ✅ 已訂閱修煉派 - 週記導向呈現
            <div className="space-y-3">
              {/* Latest Journal Preview - 本週新週記 */}
              {latestJournal && (
                <Link to={`/app/journal/${latestJournal.id}`}>
                  <FeatureCard theme="learning" variant="highlight" className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <BookOpen className="w-5 h-5 text-learning-accent" />
                      <span className="font-semibold">本週新週記</span>
                      <Badge variant="mentor" className="ml-auto text-xs">
                        {journals.length} 篇
                      </Badge>
                    </div>
                    
                    <p className="font-medium mb-2 line-clamp-1">{latestJournal.title}</p>
                    
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                      <span>{latestJournal.trades?.length || 0} 筆交易</span>
                      {latestJournal.learningPoints?.[0] && (
                        <>
                          <span>•</span>
                          <span className="line-clamp-1">{latestJournal.learningPoints[0]}</span>
                        </>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-1.5">
                      <img 
                        src={latestJournal.person.avatarUrl || '/placeholder.svg'} 
                        alt={latestJournal.person.name}
                        className="h-5 w-5 rounded-full border border-learning-accent/30"
                      />
                      <span className="text-xs text-muted-foreground">{latestJournal.person.name}</span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto" />
                    </div>
                  </FeatureCard>
                </Link>
              )}

              {/* Teacher Performance Summary */}
              <FeatureCard theme="learning" className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="h-4 w-4 text-learning-accent" />
                  <span className="text-sm font-medium">老師績效</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-auto">
                    T+7 延遲
                  </Badge>
                </div>
                <div className="space-y-2">
                  {mentorSubs.map(sub => {
                    const perf = mockPerformance[sub.person.slug] || { cumulative: 0, annualized: 0 };
                    return (
                      <Link 
                        key={sub.id} 
                        to={`/line/${sub.person.slug}/performance`}
                        className="flex items-center justify-between py-1.5 hover:bg-foreground/5 rounded-lg px-2 -mx-2 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7 border border-learning-accent/30">
                            <AvatarImage src={sub.person.avatarUrl} alt={sub.person.name} />
                            <AvatarFallback className="text-xs">{sub.person.name[0]}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm">{sub.person.name}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className={cn(
                            "font-medium",
                            perf.cumulative >= 0 ? "text-success" : "text-destructive"
                          )}>
                            累積 {perf.cumulative >= 0 ? '+' : ''}{perf.cumulative}%
                          </span>
                          <span className="text-muted-foreground">
                            年化 {perf.annualized >= 0 ? '+' : ''}{perf.annualized}%
                          </span>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </FeatureCard>

              {/* Subscribed Mentors & CTA */}
              <div className="flex items-center gap-2">
                {mentorSubs.slice(0, 3).map(sub => (
                  <Link key={sub.id} to={`/expert/${sub.person.slug}`}>
                    <Avatar className="h-10 w-10 border-2 border-learning-accent/40">
                      <AvatarImage src={sub.person.avatarUrl} alt={sub.person.name} />
                      <AvatarFallback>{sub.person.name[0]}</AvatarFallback>
                    </Avatar>
                  </Link>
                ))}
                <Link 
                  to="/app/journals" 
                  className="ml-auto text-sm text-learning-accent flex items-center gap-1 hover:underline"
                >
                  進入週記中心
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          ) : (
            // ❌ 未訂閱修煉派
            <FeatureCard theme="learning" variant="highlight" className="p-5">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl bg-learning-accent/10 flex items-center justify-center flex-shrink-0">
                  <Lock className="h-6 w-6 text-learning-accent/60" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">解鎖修煉功能</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    T+7 實戰週記，跟著導師學操作邏輯
                  </p>
                  <ul className="text-xs text-muted-foreground space-y-1 mb-4">
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-learning-accent" />
                      每週實戰週記教學
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-learning-accent" />
                      真實操作邏輯拆解
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-learning-accent" />
                      買賣點複盤檢討
                    </li>
                  </ul>
                  <Button asChild variant="mentor" size="sm" className="w-full">
                    <Link to="/app/explore">
                      探索導師
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Link>
                  </Button>
                </div>
              </div>
            </FeatureCard>
          )}
        </section>

        {/* Quick Links */}
        <section className="pt-2 space-y-2 animate-fade-in" style={{ animationDelay: '0.2s' }}>
          <Link 
            to="/app/account" 
            className="flex items-center justify-between p-4 rounded-xl bg-foreground/[0.03] border border-foreground/[0.08] hover:bg-foreground/[0.06] transition-colors"
          >
            <span className="text-sm text-muted-foreground">管理訂閱</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
          <Link 
            to="/app/explore" 
            className="flex items-center justify-between p-4 rounded-xl bg-foreground/[0.03] border border-foreground/[0.08] hover:bg-foreground/[0.06] transition-colors"
          >
            <span className="text-sm text-muted-foreground">探索更多專家</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </section>
      </div>
    </UnifiedAppLayout>
  );
};

export default AppHome;
