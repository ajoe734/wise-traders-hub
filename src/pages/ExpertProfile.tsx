import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle, ArrowRight, Shield, Clock, Check, Loader2, ArrowLeft, Target, TrendingUp, Award, Users, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PerformanceOverviewPanel } from '@/components/strategy/PerformanceOverviewPanel';
import { StrategyIntroSection } from '@/components/strategy/StrategyIntroSection';
import { useExpertPerformance } from '@/hooks/usePerformance';

interface DbPlan {
  id: string;
  name: string;
  plan_type: string;
  price_monthly: number;
  price_yearly: number | null;
  description: string | null;
  features: any;
}

interface ExpertInfo {
  id: string;
  name: string;
  bio: string;
  description: string;
  strategySummary: string;
  avatarUrl: string;
  role: 'advisor' | 'mentor';
  styleTags: string[];
  markets: string[];
  backtestReturn1y: number | null;
  backtestMaxDrawdown: number | null;
  backtestAnnualReturn: number | null;
}

const ExpertProfile = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const fromAccount = searchParams.get('from') === 'account';
  const fromExplore = searchParams.get('from') === 'explore';

  const [expertInfo, setExpertInfo] = useState<ExpertInfo | null>(null);
  const [expertNotFound, setExpertNotFound] = useState(false);
  const [dbPlans, setDbPlans] = useState<DbPlan[]>([]);
  const [subscribedPlanIds, setSubscribedPlanIds] = useState<Set<string>>(new Set());
  const [subscriberCount, setSubscriberCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const { data: perf } = useExpertPerformance(expertInfo?.id);

  useEffect(() => {
    const fetchData = async () => {
      if (!slug) return;

      const { data: expert } = await supabase
        .from('experts')
        .select('id, name, bio, description, avatar_url, role, style_tags, markets, status, strategy_summary, backtest_1y_return, backtest_max_drawdown, backtest_annual_return')
        .eq('slug', slug)
        .single();

      if (!expert || expert.status !== 'active') {
        setExpertNotFound(true);
        setLoading(false);
        return;
      }

      setExpertInfo({
        id: expert.id,
        name: expert.name,
        bio: expert.bio || '',
        description: expert.description || '',
        strategySummary: (expert as any).strategy_summary || '',
        avatarUrl: expert.avatar_url || '/placeholder.svg',
        role: expert.role as 'advisor' | 'mentor',
        styleTags: expert.style_tags || [],
        markets: expert.markets || [],
        backtestReturn1y: (expert as any).backtest_1y_return ?? null,
        backtestMaxDrawdown: (expert as any).backtest_max_drawdown ?? null,
        backtestAnnualReturn: (expert as any).backtest_annual_return ?? null,
      });

      const { data: plans } = await supabase
        .from('expert_plans')
        .select('id, name, plan_type, price_monthly, price_yearly, description, features')
        .eq('expert_id', expert.id)
        .eq('is_active', true)
        .eq('review_status', 'approved')
        .order('price_monthly');

      setDbPlans(plans || []);

      // Count active subscribers
      if (plans && plans.length > 0) {
        const planIds = plans.map(p => p.id);
        const { count } = await supabase
          .from('member_subscriptions')
          .select('id', { count: 'exact', head: true })
          .in('plan_id', planIds)
          .eq('status', 'active');
        setSubscriberCount(count || 0);
      }

      if (user) {
        const { data: subs } = await supabase
          .from('member_subscriptions')
          .select('plan_id')
          .eq('user_id', user.id)
          .eq('status', 'active');

        if (subs) {
          setSubscribedPlanIds(new Set(subs.map(s => s.plan_id)));
        }
      }

      setLoading(false);
    };

    fetchData();
  }, [slug, user]);

  if (expertNotFound) {
    return (
      <PortalLayout hideAppEntry hideHeader={!!user}>
        <div className="container py-12 text-center">
          <h1 className="text-2xl font-bold mb-4">找不到此專家</h1>
          <Button asChild><Link to="/experts">返回專家列表</Link></Button>
        </div>
      </PortalLayout>
    );
  }

  if (!expertInfo || loading) {
    return (
      <PortalLayout hideAppEntry hideHeader={!!user}>
        <div className="container py-12 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </PortalLayout>
    );
  }

  const isAdvisor = expertInfo.role === 'advisor';
  const formatPrice = (price: number) => new Intl.NumberFormat('zh-TW').format(price);

  const getPlanFeatures = (planType: string): string[] => {
    switch (planType) {
      case 'analyst_signal_l1': return ['即時訊號推播通知', '完整買賣理由說明', '風險與部位控管建議', '交易紀錄完整保存'];
      case 'analyst_signal_diag_l2': return ['等級 1 所有功能', '持股診斷報告', '個人化投資組合建議', '專屬風險評估'];
      case 'mentor_weekly_journal': return ['T+7 延遲實戰週記', '完整操作邏輯拆解', '事後檢討與學習重點', '策略思維培養'];
      default: return [];
    }
  };

  const getPlanLabel = (planType: string) => {
    switch (planType) {
      case 'analyst_signal_l1': return '即時訊號通知';
      case 'analyst_signal_diag_l2': return '訊號 + 持股健檢';
      case 'mentor_weekly_journal': return 'T+7 延遲・週記式教學';
      default: return '';
    }
  };
  const getPlanNote = (planType: string) => planType === 'mentor_weekly_journal' ? '所有內容均延遲 7 天以上（T+7），僅作為歷史案例教學用途，不構成即時投資建議。' : '包含具體買賣指示，屬投顧服務。';

  const defaultBack = user ? '/app/explore' : '/experts';
  const defaultBackLabel = user ? '返回探索專家' : '返回專家列表';
  const backButton = fromAccount
    ? <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate('/app/account')}><ArrowLeft className="h-4 w-4 mr-1" />返回帳號設定</Button>
    : fromExplore
      ? <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate('/app/explore')}><ArrowLeft className="h-4 w-4 mr-1" />返回探索專家</Button>
      : <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate(defaultBack)}><ArrowLeft className="h-4 w-4 mr-1" />{defaultBackLabel}</Button>;

  return (
    <PortalLayout hideAppEntry hideHeader={!!user}>
      <div className="container py-8 md:py-12 space-y-12">
        {backButton}

        {/* ── Hero Section ── */}
        <section className="relative overflow-hidden rounded-2xl">
          <div className={cn(
            "absolute inset-0 opacity-[0.07]",
            isAdvisor ? "gradient-advisor" : "gradient-mentor"
          )} />
          <div className="relative px-6 py-10 md:px-10 md:py-14">
            <div className="flex flex-col md:flex-row gap-6 md:gap-10 items-start">
              <img
                src={expertInfo.avatarUrl}
                alt={expertInfo.name}
                className={cn(
                  "h-32 w-32 md:h-40 md:w-40 rounded-2xl object-cover ring-4 shadow-xl",
                  isAdvisor ? "ring-advisor/30" : "ring-mentor/30"
                )}
              />
              <div className="flex-1 space-y-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-h2 md:text-h1">{expertInfo.name}</h1>
                  <RoleBadge role={expertInfo.role} size="lg" />
                </div>
                <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-2xl">
                  {expertInfo.bio}
                </p>
                {/* Quick Stats */}
                <div className="flex flex-wrap gap-4 pt-2">
                  {expertInfo.styleTags.map(tag => (
                    <Badge key={tag} variant="secondary" className="text-sm px-3 py-1">{tag}</Badge>
                  ))}
                  {expertInfo.markets.map(market => (
                    <Badge key={market} variant="outline" className="text-sm px-3 py-1">{market}</Badge>
                  ))}
                </div>
                {/* Social Proof */}
                {subscriberCount !== null && subscriberCount > 0 && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground pt-1">
                    <Users className="h-4 w-4" />
                    <span>已有 <strong className="text-foreground">{subscriberCount}</strong> 人訂閱</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>




        {/* ── Performance Section ── */}
        <section>
          <div className="flex items-center gap-2 mb-6">
            <Target className={cn("h-5 w-5", isAdvisor ? "text-advisor" : "text-mentor")} />
            <h2 className="text-h3">績效總覽</h2>
          </div>
          <PerformanceOverviewPanel
            expertSlug={slug || ""}
            variant={isAdvisor ? 'advisor' : 'mentor'}
          />
        </section>


        {/* ── Plans Section ── */}
        <section id="plans" className="scroll-mt-20">
          <div className="flex items-center gap-2 mb-6">
            <TrendingUp className={cn("h-5 w-5", isAdvisor ? "text-advisor" : "text-mentor")} />
            <h2 className="text-h3">訂閱方案</h2>
          </div>

          {dbPlans.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-muted-foreground">目前尚無可訂閱的方案</CardContent></Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-6">
              {dbPlans.map(plan => {
                const isSubscribed = subscribedPlanIds.has(plan.id);
                const isFollowerType = plan.plan_type !== 'mentor_weekly_journal';

                return (
                  <Card key={plan.id} className={cn(
                    "relative overflow-hidden border-2 transition-all",
                    isSubscribed
                      ? isFollowerType ? "border-advisor/40 bg-advisor/5" : "border-mentor/40 bg-mentor/5"
                      : isFollowerType ? "border-advisor/20 hover:border-advisor/40 hover:shadow-lg" : "border-mentor/20 hover:border-mentor/40 hover:shadow-lg"
                  )}>
                    <div className={cn("absolute top-0 left-0 right-0 h-1", isFollowerType ? "gradient-advisor" : "gradient-mentor")} />
                    {isSubscribed && (
                      <Badge className={cn("absolute top-3 right-3", isFollowerType ? "bg-advisor text-advisor-foreground" : "bg-mentor text-mentor-foreground")}>
                        <Check className="h-3 w-3 mr-1" />已訂閱
                      </Badge>
                    )}
                    <CardHeader>
                      <CardTitle className="text-lg">{plan.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">{getPlanLabel(plan.plan_type)}</p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {plan.description && <p className="text-muted-foreground text-sm">{plan.description}</p>}
                      <ul className="space-y-2">
                        {getPlanFeatures(plan.plan_type).map((feature, idx) => (
                          <li key={idx} className="flex items-center gap-2 text-sm">
                            <CheckCircle className={cn("h-4 w-4 shrink-0", isFollowerType ? "text-advisor" : "text-mentor")} />
                            {feature}
                          </li>
                        ))}
                      </ul>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold">NT$ {formatPrice(plan.price_monthly)}</span>
                        <span className="text-muted-foreground">/ 月</span>
                      </div>
                      {plan.price_yearly && (
                        <p className="text-xs text-muted-foreground">
                          年繳 NT$ {formatPrice(plan.price_yearly)}（省 {Math.round((1 - plan.price_yearly / (plan.price_monthly * 12)) * 100)}%）
                        </p>
                      )}
                      <div className={cn("flex items-start gap-2 p-3 rounded-lg text-sm", isFollowerType ? "bg-advisor/5 text-advisor" : "bg-mentor/5 text-mentor")}>
                        {isFollowerType ? <Shield className="h-4 w-4 mt-0.5 shrink-0" /> : <Clock className="h-4 w-4 mt-0.5 shrink-0" />}
                        <span>{getPlanNote(plan.plan_type)}</span>
                      </div>
                      {isSubscribed ? (
                        <Button variant="outline" className={cn("w-full", isFollowerType ? "border-advisor text-advisor hover:bg-advisor/10" : "border-mentor text-mentor hover:bg-mentor/10")} disabled>
                          <Check className="h-4 w-4 mr-1" />已訂閱
                        </Button>
                      ) : (
                        <Button variant={isFollowerType ? 'advisor' as any : 'mentor' as any} size="xl" className="w-full" asChild>
                          <Link to={`/checkout/${slug}/${plan.id}`}>立即訂閱<ArrowRight className="h-4 w-4 ml-2" /></Link>
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* Compliance Disclaimer */}
        <div className="compliance-disclaimer">
          <p>過去績效不代表未來表現，投資有風險，請謹慎評估。</p>
        </div>
      </div>
    </PortalLayout>
  );
};

export default ExpertProfile;
