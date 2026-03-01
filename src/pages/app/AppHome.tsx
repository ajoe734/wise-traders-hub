import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SectionHeader } from '@/components/ui/section-header';
import { StatCard } from '@/components/ui/stat-card';
import { FeatureCard } from '@/components/ui/feature-card';

import { UnifiedAppLayout } from '@/components/layouts/UnifiedAppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
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
import { isToday, differenceInMinutes, format } from 'date-fns';
import { zhTW } from 'date-fns/locale';

interface DbSubscription {
  id: string;
  status: string;
  plan: {
    id: string;
    name: string;
    plan_type: string;
  };
  expert: {
    id: string;
    name: string;
    slug: string;
    avatar_url: string | null;
    role: string;
  };
}

interface DbSignal {
  id: string;
  instrument: string;
  action: string;
  reason_summary: string | null;
  published_at: string | null;
  expert_id: string;
  experts: {
    name: string;
    avatar_url: string | null;
  } | null;
}

interface DbPerformance {
  expert_id: string;
  win_rate: number;
  cumulative_return: number;
  total_trades: number;
}

const actionLabels: Record<string, string> = {
  buy: '買進',
  add: '加碼',
  sell: '賣出',
  trim: '減碼',
  exit: '出場',
};

const AppHome = () => {
  const { user } = useAuth();
  const [subscriptions, setSubscriptions] = useState<DbSubscription[]>([]);
  const [signals, setSignals] = useState<DbSignal[]>([]);
  const [performances, setPerformances] = useState<Record<string, DbPerformance>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) fetchData();
    else setLoading(false);
  }, [user]);

  const fetchData = async () => {
    setLoading(true);

    // Fetch active subscriptions with plan + expert info
    const { data: subs } = await supabase
      .from('member_subscriptions')
      .select('id, status, plan_id, expert_plans(id, name, plan_type, expert_id, experts(id, name, slug, avatar_url, role))')
      .eq('user_id', user!.id)
      .eq('status', 'active');

    const mapped: DbSubscription[] = (subs || []).map((s: any) => ({
      id: s.id,
      status: s.status,
      plan: {
        id: s.expert_plans?.id || '',
        name: s.expert_plans?.name || '',
        plan_type: s.expert_plans?.plan_type || '',
      },
      expert: {
        id: s.expert_plans?.experts?.id || '',
        name: s.expert_plans?.experts?.name || '',
        slug: s.expert_plans?.experts?.slug || '',
        avatar_url: s.expert_plans?.experts?.avatar_url || null,
        role: s.expert_plans?.experts?.role || '',
      },
    }));
    setSubscriptions(mapped);

    // Fetch signals (RLS already filters by subscription)
    const { data: sigData } = await supabase
      .from('expert_signals')
      .select('id, instrument, action, reason_summary, published_at, expert_id, experts(name, avatar_url)')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(10);

    if (sigData) setSignals(sigData as unknown as DbSignal[]);

    // Fetch performance for subscribed experts
    const expertIds = [...new Set(mapped.map(s => s.expert.id).filter(Boolean))];
    const perfMap: Record<string, DbPerformance> = {};
    for (const eid of expertIds) {
      const { data: perfData } = await supabase.rpc('calculate_expert_performance', { _expert_id: eid });
      if (perfData) {
        const p = perfData as any;
        perfMap[eid] = {
          expert_id: eid,
          win_rate: p.win_rate || 0,
          cumulative_return: p.cumulative_return || 0,
          total_trades: p.total_trades || 0,
        };
      }
    }
    setPerformances(perfMap);

    setLoading(false);
  };

  // Filter subscriptions by type
  const advisorSubs = subscriptions.filter(s => 
    s.plan.plan_type === 'analyst_signal_l1' || s.plan.plan_type === 'analyst_signal_diag_l2'
  );
  const mentorSubs = subscriptions.filter(s => 
    s.plan.plan_type === 'mentor_weekly_journal'
  );

  const hasAdvisor = advisorSubs.length > 0;
  const hasMentor = mentorSubs.length > 0;

  // Today's signals
  const todaySignals = signals.filter(s => s.published_at && isToday(new Date(s.published_at)));
  const latestSignal = signals[0];

  const getTimeLabel = (dateStr: string) => {
    const date = new Date(dateStr);
    const mins = differenceInMinutes(new Date(), date);
    if (mins < 60) return `${mins} 分鐘前`;
    return format(date, 'HH:mm');
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
                嗨，{user?.displayName || '會員'}
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
            <div className="space-y-3">
              {/* Quick Stats */}
              <div className="grid grid-cols-2 gap-2">
                <StatCard
                  label="今日訊號"
                  value={todaySignals.length}
                  sublabel="筆"
                  theme="signals"
                  glowing={todaySignals.length > 0}
                />
                <StatCard
                  label="訂閱分析師"
                  value={advisorSubs.length}
                  sublabel="位"
                  theme="signals"
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
                            variant={latestSignal.action === 'buy' || latestSignal.action === 'add' ? 'advisor' : 'outline'}
                            className="text-xs"
                          >
                            {actionLabels[latestSignal.action] || latestSignal.action}
                          </Badge>
                          {latestSignal.published_at && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {getTimeLabel(latestSignal.published_at)}
                            </span>
                          )}
                        </div>
                        <p className="font-semibold truncate">{latestSignal.instrument}</p>
                        {latestSignal.experts && (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <img 
                              src={latestSignal.experts.avatar_url || '/placeholder.svg'} 
                              alt={latestSignal.experts.name}
                              className="h-5 w-5 rounded-full border border-signals-accent/30"
                            />
                            <span className="text-xs text-muted-foreground">{latestSignal.experts.name}</span>
                          </div>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                    </div>
                  </FeatureCard>
                </Link>
              )}

              {/* Advisor Performance Summary */}
              <FeatureCard theme="signals" className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="h-4 w-4 text-signals-accent" />
                  <span className="text-sm font-medium">分析師績效</span>
                </div>
                <div className="space-y-2">
                  {advisorSubs.map(sub => {
                    const perf = performances[sub.expert.id];
                    return (
                      <Link 
                        key={sub.id} 
                        to={`/app/expert/${sub.expert.slug}`}
                        className="flex items-center justify-between py-1.5 hover:bg-foreground/5 rounded-lg px-2 -mx-2 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7 border border-signals-accent/30">
                            <AvatarImage src={sub.expert.avatar_url || undefined} alt={sub.expert.name} />
                            <AvatarFallback className="text-xs">{sub.expert.name[0]}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm">{sub.expert.name}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          {perf ? (
                            <>
                              <span className={cn(
                                "font-medium",
                                perf.cumulative_return >= 0 ? "text-success" : "text-destructive"
                              )}>
                                累積 {perf.cumulative_return >= 0 ? '+' : ''}{perf.cumulative_return}%
                              </span>
                              <span className="text-muted-foreground">
                                {perf.total_trades} 筆
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">尚無數據</span>
                          )}
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </FeatureCard>

              {/* CTA */}
              <div className="flex items-center gap-2">
                {advisorSubs.slice(0, 3).map(sub => (
                  <Link key={sub.id} to={`/expert/${sub.expert.slug}`}>
                    <Avatar className="h-10 w-10 border-2 border-signals-accent/40">
                      <AvatarImage src={sub.expert.avatar_url || undefined} alt={sub.expert.name} />
                      <AvatarFallback>{sub.expert.name[0]}</AvatarFallback>
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
            <div className="space-y-3">
              {/* Mentor Performance Summary */}
              <FeatureCard theme="learning" className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="h-4 w-4 text-learning-accent" />
                  <span className="text-sm font-medium">導師績效</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-auto">
                    T+7 延遲
                  </Badge>
                </div>
                <div className="space-y-2">
                  {mentorSubs.map(sub => {
                    const perf = performances[sub.expert.id];
                    return (
                      <Link 
                        key={sub.id} 
                        to={`/app/expert/${sub.expert.slug}`}
                        className="flex items-center justify-between py-1.5 hover:bg-foreground/5 rounded-lg px-2 -mx-2 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7 border border-learning-accent/30">
                            <AvatarImage src={sub.expert.avatar_url || undefined} alt={sub.expert.name} />
                            <AvatarFallback className="text-xs">{sub.expert.name[0]}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm">{sub.expert.name}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          {perf ? (
                            <>
                              <span className={cn(
                                "font-medium",
                                perf.cumulative_return >= 0 ? "text-success" : "text-destructive"
                              )}>
                                累積 {perf.cumulative_return >= 0 ? '+' : ''}{perf.cumulative_return}%
                              </span>
                              <span className="text-muted-foreground">
                                {perf.total_trades} 筆
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">尚無數據</span>
                          )}
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
                  <Link key={sub.id} to={`/expert/${sub.expert.slug}`}>
                    <Avatar className="h-10 w-10 border-2 border-learning-accent/40">
                      <AvatarImage src={sub.expert.avatar_url || undefined} alt={sub.expert.name} />
                      <AvatarFallback>{sub.expert.name[0]}</AvatarFallback>
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
                    T+7 修煉派週記，跟著導師學操作邏輯
                  </p>
                  <ul className="text-xs text-muted-foreground space-y-1 mb-4">
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-learning-accent" />
                      每週修煉派週記教學
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
