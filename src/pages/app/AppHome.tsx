import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SectionHeader } from '@/components/ui/section-header';
import { FeatureCard } from '@/components/ui/feature-card';

import { UnifiedAppLayout } from '@/components/layouts/UnifiedAppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useExpertPerformance } from '@/hooks/usePerformance';
import { 
  Target, Compass, Radio, ChevronRight, BookOpen, Lock, CheckCircle2, BarChart3,
  Megaphone, X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

interface SubExpert {
  slug: string;
  name: string;
  avatar_url: string | null;
  role: string;
  id: string;
  status?: string;
}

interface DbSubscription {
  plan_id: string;
  plan_type: string;
  expert: SubExpert;
}

const fetchHomeData = async (userId: string | undefined) => {
  if (!userId) return { advisorSubs: [] as DbSubscription[], mentorSubs: [] as DbSubscription[], hasAdvisor: false, hasMentor: false };

  const { data: subs } = await supabase
    .from('member_subscriptions')
    .select('plan_id, expert_plans(plan_type, expert_id, experts(id, slug, name, avatar_url, role, status))')
    .eq('user_id', userId)
    .eq('status', 'active');

  const allSubs: DbSubscription[] = (subs || []).map((s: any) => ({
    plan_id: s.plan_id,
    plan_type: s.expert_plans?.plan_type || '',
    expert: {
      id: s.expert_plans?.experts?.id || '',
      slug: s.expert_plans?.experts?.slug || '',
      name: s.expert_plans?.experts?.name || '',
      avatar_url: s.expert_plans?.experts?.avatar_url || null,
      role: s.expert_plans?.experts?.role || '',
      status: s.expert_plans?.experts?.status || 'active',
    },
  })).filter(s => s.expert.slug && s.expert.status === 'active');

  const advisorSubs = allSubs.filter(s => s.plan_type === 'analyst_signal_l1' || s.plan_type === 'analyst_signal_diag_l2');
  const mentorSubs = allSubs.filter(s => s.plan_type === 'mentor_weekly_journal');

  return { advisorSubs, mentorSubs, hasAdvisor: advisorSubs.length > 0, hasMentor: mentorSubs.length > 0 };
};

function ExpertPerfRow({ sub }: { sub: DbSubscription }) {
  const { data: perf } = useExpertPerformance(sub.expert.id || undefined);
  const cumulative = perf?.cumulative_return ?? 0;

  return (
    <Link 
      key={sub.plan_id} 
      to={`/app/expert/${sub.expert.slug}`}
      className="flex items-center justify-between py-1.5 hover:bg-foreground/5 rounded-lg px-2 -mx-2 transition-colors"
    >
      <div className="flex items-center gap-2">
        <Avatar className={cn("h-7 w-7 border", sub.expert.role === 'mentor' ? 'border-learning-accent/30' : 'border-signals-accent/30')}>
          <AvatarImage src={sub.expert.avatar_url || '/placeholder.svg'} alt={sub.expert.name} />
          <AvatarFallback className="text-xs">{sub.expert.name[0]}</AvatarFallback>
        </Avatar>
        <span className="text-sm">{sub.expert.name}</span>
      </div>
      <div className="flex items-center gap-3 text-xs">
        <span className={cn("font-medium", cumulative > 0 ? "text-success" : cumulative < 0 ? "text-destructive" : sub.expert.role === 'mentor' ? "text-learning-accent" : "text-signals-accent")}>
          累積 {cumulative >= 0 ? '+' : ''}{cumulative}%
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    </Link>
  );
}

function AnnouncementBanner() {
  const [dismissed, setDismissed] = useState<string | null>(null);

  const { data: announcement } = useQuery({
    queryKey: ['latest-announcement'],
    queryFn: async () => {
      const { data } = await supabase
        .from('announcements')
        .select('id, title, content, published_at')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    staleTime: 60_000,
  });

  if (!announcement || dismissed === announcement.id) return null;

  return (
    <div className="relative rounded-xl border border-primary/20 bg-primary/5 p-3 animate-fade-in">
      <button
        onClick={() => setDismissed(announcement.id)}
        className="absolute top-2 right-2 p-1 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="關閉公告"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-start gap-2.5 pr-6">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Megaphone className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-primary mb-0.5">系統公告</p>
          <p className="text-sm font-medium">{announcement.title}</p>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{announcement.content}</p>
        </div>
      </div>
    </div>
  );
}

const AppHome = () => {
  const { user } = useAuth();

  const { data: homeData } = useQuery({
    queryKey: ['app-home', user?.id],
    queryFn: () => fetchHomeData(user?.id),
    staleTime: Infinity,
  });

  const advisorSubs = homeData?.advisorSubs ?? [];
  const mentorSubs = homeData?.mentorSubs ?? [];
  const hasAdvisor = homeData?.hasAdvisor ?? false;
  const hasMentor = homeData?.hasMentor ?? false;

  return (
    <UnifiedAppLayout>
      <div className="p-4 space-y-6 max-w-lg mx-auto pb-24">
        <div className="relative animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-[0_0_20px_-5px_hsl(var(--primary)/0.5)]">
                <Target className="h-6 w-6 text-white" />
              </div>
            </div>
            <div>
              <p className="text-xs text-primary font-semibold tracking-wider uppercase">會員戰情室</p>
              <h1 className="text-xl font-bold">嗨，{user?.displayName || '會員'}</h1>
            </div>
          </div>
        </div>

        {/* 跟單派區塊 */}
        <section className="animate-slide-up">
          <SectionHeader number="01" tag={hasAdvisor ? '訂閱中' : '未訂閱'} title="跟單派 · SIGNALS" icon={<Radio className="h-3.5 w-3.5" />} theme="signals" className="mb-4" />
          {hasAdvisor ? (
            <div className="space-y-3">
              <FeatureCard theme="signals" className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="h-4 w-4 text-signals-accent" /><span className="text-sm font-medium">分析師績效</span>
                </div>
                <div className="space-y-2">
                  {advisorSubs.map(sub => <ExpertPerfRow key={sub.plan_id} sub={sub} />)}
                </div>
              </FeatureCard>
              <div className="flex items-center gap-2">
                {advisorSubs.slice(0, 3).map(sub => (
                  <Link key={sub.plan_id} to={`/app/expert/${sub.expert.slug}`}>
                    <Avatar className="h-10 w-10 border-2 border-signals-accent/40">
                      <AvatarImage src={sub.expert.avatar_url || '/placeholder.svg'} alt={sub.expert.name} />
                      <AvatarFallback>{sub.expert.name[0]}</AvatarFallback>
                    </Avatar>
                  </Link>
                ))}
                <Link to="/app/signals" className="ml-auto text-sm text-signals-accent flex items-center gap-1 hover:underline">
                  進入訊號中心<ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          ) : (
            <FeatureCard theme="signals" variant="highlight" className="p-5">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl bg-signals-accent/10 flex items-center justify-center flex-shrink-0"><Lock className="h-6 w-6 text-signals-accent/60" /></div>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">解鎖跟單功能</h3>
                  <p className="text-sm text-muted-foreground mb-3">即時跟單，讓專業分析師帶你操作</p>
                  <ul className="text-xs text-muted-foreground space-y-1 mb-4">
                    <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-signals-accent" />即時買賣訊號通知</li>
                    <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-signals-accent" />持倉管理與績效追蹤</li>
                    <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-signals-accent" />分析師操作邏輯解說</li>
                  </ul>
                  <Button asChild variant="advisor" size="sm" className="w-full">
                    <Link to="/app/explore">探索分析師<ChevronRight className="h-4 w-4 ml-1" /></Link>
                  </Button>
                </div>
              </div>
            </FeatureCard>
          )}
        </section>

        {/* 修煉派區塊 */}
        <section className="animate-slide-up" style={{ animationDelay: '0.1s' }}>
          <SectionHeader number="02" tag={hasMentor ? '訂閱中' : '未訂閱'} title="修煉派 · LEARNING" icon={<Compass className="h-3.5 w-3.5" />} theme="learning" className="mb-4" />
          {hasMentor ? (
            <div className="space-y-3">
              <FeatureCard theme="learning" className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="h-4 w-4 text-learning-accent" /><span className="text-sm font-medium">導師績效</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-auto">T+7 延遲</Badge>
                </div>
                <div className="space-y-2">
                  {mentorSubs.map(sub => <ExpertPerfRow key={sub.plan_id} sub={sub} />)}
                </div>
              </FeatureCard>
              <div className="flex items-center gap-2">
                {mentorSubs.slice(0, 3).map(sub => (
                  <Link key={sub.plan_id} to={`/app/expert/${sub.expert.slug}`}>
                    <Avatar className="h-10 w-10 border-2 border-learning-accent/40">
                      <AvatarImage src={sub.expert.avatar_url || '/placeholder.svg'} alt={sub.expert.name} />
                      <AvatarFallback>{sub.expert.name[0]}</AvatarFallback>
                    </Avatar>
                  </Link>
                ))}
                <Link to="/app/journals" className="ml-auto text-sm text-learning-accent flex items-center gap-1 hover:underline">
                  進入週記中心<ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          ) : (
            <FeatureCard theme="learning" variant="highlight" className="p-5">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl bg-learning-accent/10 flex items-center justify-center flex-shrink-0"><Lock className="h-6 w-6 text-learning-accent/60" /></div>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">解鎖修煉功能</h3>
                  <p className="text-sm text-muted-foreground mb-3">T+7 修煉派週記，跟著導師學操作邏輯</p>
                  <ul className="text-xs text-muted-foreground space-y-1 mb-4">
                    <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-learning-accent" />每週修煉派週記教學</li>
                    <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-learning-accent" />真實操作邏輯拆解</li>
                    <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-learning-accent" />買賣點複盤檢討</li>
                  </ul>
                  <Button asChild variant="mentor" size="sm" className="w-full">
                    <Link to="/app/explore">探索導師<ChevronRight className="h-4 w-4 ml-1" /></Link>
                  </Button>
                </div>
              </div>
            </FeatureCard>
          )}
        </section>

        {/* Quick Links */}
        <section className="pt-2 space-y-2 animate-fade-in" style={{ animationDelay: '0.2s' }}>
          <Link to="/app/account" className="flex items-center justify-between p-4 rounded-xl bg-foreground/[0.03] border border-foreground/[0.08] hover:bg-foreground/[0.06] transition-colors">
            <span className="text-sm text-muted-foreground">管理訂閱</span><ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
          <Link to="/app/explore" className="flex items-center justify-between p-4 rounded-xl bg-foreground/[0.03] border border-foreground/[0.08] hover:bg-foreground/[0.06] transition-colors">
            <span className="text-sm text-muted-foreground">探索更多專家</span><ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
          <Link to="/free-checkup" className="flex items-center justify-between p-4 rounded-xl bg-foreground/[0.03] border border-foreground/[0.08] hover:bg-foreground/[0.06] transition-colors">
            <span className="text-sm text-muted-foreground">免費健檢</span><ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </section>
      </div>
    </UnifiedAppLayout>
  );
};

export default AppHome;
