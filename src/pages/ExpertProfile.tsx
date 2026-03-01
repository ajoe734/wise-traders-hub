import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PersonRole } from '@/types';
import { CheckCircle, ArrowRight, Shield, Clock, TrendingUp, Check, Loader2, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getPersonBySlug } from '@/data/mockData';

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
  name: string;
  bio: string;
  description: string;
  avatarUrl: string;
  role: 'advisor' | 'mentor';
  styleTags: string[];
  markets: string[];
  riskTolerance?: string;
  timeframe?: string;
  tradingSystems: { id: string; name: string; description: string }[];
}

const ExpertProfile = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const fromAccount = searchParams.get('from') === 'account';

  const [expertInfo, setExpertInfo] = useState<ExpertInfo | null>(null);
  const [expertNotFound, setExpertNotFound] = useState(false);
  const [dbPlans, setDbPlans] = useState<DbPlan[]>([]);
  const [subscribedPlanIds, setSubscribedPlanIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Try mock data first, then DB
  useEffect(() => {
    const fetchData = async () => {
      if (!slug) return;

      // Try mock data first
      const person = getPersonBySlug(slug);
      if (person) {
        setExpertInfo({
          name: person.name,
          bio: person.bio || '',
          description: person.description || '',
          avatarUrl: person.avatarUrl || '/placeholder.svg',
          role: person.role === PersonRole.ADVISOR ? 'advisor' : 'mentor',
          styleTags: person.styleTags || [],
          markets: person.markets || [],
          riskTolerance: person.riskTolerance,
          timeframe: person.timeframe,
          tradingSystems: person.tradingSystems || [],
        });
      }

      // Find expert by slug in DB
      const { data: expert } = await supabase
        .from('experts')
        .select('id, name, bio, description, avatar_url, role, style_tags, markets')
        .eq('slug', slug)
        .single();

      if (!expert && !person) {
        setExpertNotFound(true);
        setLoading(false);
        return;
      }

      // If no mock data, use DB data
      if (!person && expert) {
        setExpertInfo({
          name: expert.name,
          bio: expert.bio || '',
          description: expert.description || '',
          avatarUrl: expert.avatar_url || '/placeholder.svg',
          role: expert.role as 'advisor' | 'mentor',
          styleTags: expert.style_tags || [],
          markets: expert.markets || [],
          tradingSystems: [],
        });
      }

      if (expert) {
        // Fetch active approved plans
        const { data: plans } = await supabase
          .from('expert_plans')
          .select('id, name, plan_type, price_monthly, price_yearly, description, features')
          .eq('expert_id', expert.id)
          .eq('is_active', true)
          .eq('review_status', 'approved')
          .order('price_monthly');

        setDbPlans(plans || []);

        // Check subscriptions if user is logged in
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
      }

      setLoading(false);
    };

    fetchData();
  }, [slug, user]);

  if (expertNotFound) {
    return (
      <PortalLayout>
        <div className="container py-12 text-center">
          <h1 className="text-2xl font-bold mb-4">找不到此專家</h1>
          <Button asChild>
            <Link to="/experts">返回專家列表</Link>
          </Button>
        </div>
      </PortalLayout>
    );
  }

  if (!expertInfo) {
    return (
      <PortalLayout>
        <div className="container py-12 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </PortalLayout>
    );
  }

  const isAdvisor = expertInfo.role === 'advisor';

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('zh-TW').format(price);
  };

  const getPlanFeatures = (planType: string): string[] => {
    switch (planType) {
      case 'analyst_signal_l1':
        return [
          '即時訊號推播通知',
          '完整買賣理由說明',
          '風險與部位控管建議',
          '交易紀錄完整保存',
        ];
      case 'analyst_signal_diag_l2':
        return [
          '等級 1 所有功能',
          '持股診斷報告',
          '個人化投資組合建議',
          '專屬風險評估',
        ];
      case 'mentor_weekly_journal':
        return [
          '每週實戰週記',
          '完整操作邏輯拆解',
          '事後檢討與學習重點',
          '策略思維培養',
        ];
      default:
        return [];
    }
  };

  const getPlanVariant = (planType: string) => {
    if (planType === 'mentor_weekly_journal') return 'mentor' as const;
    return 'advisor' as const;
  };

  const getPlanLabel = (planType: string) => {
    switch (planType) {
      case 'analyst_signal_l1': return '即時訊號通知';
      case 'analyst_signal_diag_l2': return '訊號 + 持股健檢';
      case 'mentor_weekly_journal': return 'T+7 延遲・週記式教學';
      default: return '';
    }
  };

  const getPlanNote = (planType: string) => {
    if (planType === 'mentor_weekly_journal') {
      return '所有內容延遲 7 天，僅供教學參考。';
    }
    return '包含具體買賣指示，屬投顧服務。';
  };

  return (
    <PortalLayout>
      <div className="container py-8 md:py-12">
        {/* Back to account */}
        {fromAccount && (
          <Button
            variant="ghost"
            size="sm"
            className="mb-4"
            onClick={() => navigate('/app/account')}
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回帳號設定
          </Button>
        )}
        {/* Hero Header */}
        <div className="relative mb-12">
          <div className={cn(
            "absolute inset-0 rounded-3xl opacity-5",
            isAdvisor ? "gradient-advisor" : "gradient-mentor"
          )} />
          <div className="relative flex flex-col md:flex-row gap-6 items-start p-6 md:p-8">
            <img
              src={expertInfo.avatarUrl}
              alt={expertInfo.name}
              className={cn(
                "h-28 w-28 md:h-36 md:w-36 rounded-2xl object-cover ring-4 shadow-lg",
                isAdvisor ? "ring-advisor/20" : "ring-mentor/20"
              )}
            />
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <h1 className="text-2xl md:text-3xl font-bold">{expertInfo.name}</h1>
                <RoleBadge role={isAdvisor ? PersonRole.ADVISOR : PersonRole.MENTOR} size="lg" />
              </div>
              <p className="text-lg text-muted-foreground mb-4">{expertInfo.bio}</p>
              <p className="text-muted-foreground">{expertInfo.description}</p>
            </div>
          </div>
        </div>

        {/* Style & Info */}
        <div className="grid md:grid-cols-2 gap-6 mb-12">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">投資風格</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-2">風格標籤</p>
                <div className="flex flex-wrap gap-2">
                  {expertInfo.styleTags.map(tag => (
                    <Badge key={tag} variant="secondary">{tag}</Badge>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">主要市場</p>
                  <div className="flex flex-wrap gap-1">
                    {expertInfo.markets.map(market => (
                      <Badge key={market} variant="outline">{market}</Badge>
                    ))}
                  </div>
                </div>
                {expertInfo.riskTolerance && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">風險偏好</p>
                    <p className="font-medium">{expertInfo.riskTolerance}</p>
                  </div>
                )}
              </div>
              {expertInfo.timeframe && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">操作週期</p>
                  <p className="font-medium">{expertInfo.timeframe}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">交易系統</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {expertInfo.tradingSystems.map(system => (
                <div key={system.id} className="p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    <p className="font-medium">{system.name}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">{system.description}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Strategy Preview */}
        {expertInfo.tradingSystems.length > 0 && (
          <div className="mb-12">
            <h2 className="text-xl md:text-2xl font-bold mb-6">策略簡介</h2>
            <Card className="overflow-hidden">
              <div className={cn("h-1", isAdvisor ? "gradient-advisor" : "gradient-mentor")} />
              <CardContent className="p-6">
                <div className="grid md:grid-cols-3 gap-6">
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">近 1 年報酬</p>
                    <p className="text-2xl font-bold text-success">+24.5%</p>
                    <p className="text-xs text-muted-foreground">回測/模擬數據，僅供參考</p>
                  </div>
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">最大回撤</p>
                    <p className="text-2xl font-bold text-warning">-12.3%</p>
                    <p className="text-xs text-muted-foreground">風險指標</p>
                  </div>
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">年化報酬</p>
                    <p className="text-2xl font-bold">18.7%</p>
                    <p className="text-xs text-muted-foreground">回測數據</p>
                  </div>
                </div>
                <p className="text-center text-xs text-muted-foreground mt-4">
                  ⚠️ 以上為歷史回測或模擬數據，過去績效不代表未來表現
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Plans Section - from DB */}
        <div id="plans" className="scroll-mt-20">
          <h2 className="text-xl md:text-2xl font-bold mb-6">訂閱方案</h2>
          
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : dbPlans.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                目前尚無可訂閱的方案
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-6">
              {dbPlans.map(plan => {
                const isSubscribed = subscribedPlanIds.has(plan.id);
                const variant = getPlanVariant(plan.plan_type);
                const isFollowerType = plan.plan_type !== 'mentor_weekly_journal';

                return (
                  <Card
                    key={plan.id}
                    className={cn(
                      "relative overflow-hidden border-2",
                      isSubscribed
                        ? isFollowerType
                          ? "border-advisor/40 bg-advisor/5"
                          : "border-mentor/40 bg-mentor/5"
                        : isFollowerType
                          ? "border-advisor/20 hover:border-advisor/40"
                          : "border-mentor/20 hover:border-mentor/40"
                    )}
                  >
                    <div className={cn(
                      "absolute top-0 left-0 right-0 h-1",
                      isFollowerType ? "gradient-advisor" : "gradient-mentor"
                    )} />
                    {isSubscribed && (
                      <Badge className={cn(
                        "absolute top-3 right-3",
                        isFollowerType ? "bg-advisor text-advisor-foreground" : "bg-mentor text-mentor-foreground"
                      )}>
                        <Check className="h-3 w-3 mr-1" />
                        已訂閱
                      </Badge>
                    )}
                    <CardHeader>
                      <CardTitle className="text-lg">{plan.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">{getPlanLabel(plan.plan_type)}</p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {plan.description && (
                        <p className="text-muted-foreground text-sm">{plan.description}</p>
                      )}

                      <ul className="space-y-2">
                        {getPlanFeatures(plan.plan_type).map((feature, idx) => (
                          <li key={idx} className="flex items-center gap-2 text-sm">
                            <CheckCircle className={cn(
                              "h-4 w-4",
                              isFollowerType ? "text-advisor" : "text-mentor"
                            )} />
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

                      <div className={cn(
                        "flex items-start gap-2 p-3 rounded-lg text-sm",
                        isFollowerType ? "bg-advisor/5 text-advisor" : "bg-mentor/5 text-mentor"
                      )}>
                        {isFollowerType ? (
                          <Shield className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        ) : (
                          <Clock className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        )}
                        <span>{getPlanNote(plan.plan_type)}</span>
                      </div>

                      {isSubscribed ? (
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full",
                            isFollowerType 
                              ? "border-advisor text-advisor hover:bg-advisor/10" 
                              : "border-mentor text-mentor hover:bg-mentor/10"
                          )}
                          disabled
                        >
                          <Check className="h-4 w-4 mr-2" />
                          已訂閱此方案
                        </Button>
                      ) : (
                        <Button
                          variant={variant}
                          className="w-full"
                          asChild
                        >
                          <Link to={`/checkout/${slug}/${plan.id}`}>
                            訂閱此方案
                            <ArrowRight className="h-4 w-4 ml-2" />
                          </Link>
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Disclaimer */}
        <Card className="mt-12 bg-muted/30">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <Shield className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div className="text-sm text-muted-foreground">
                {isAdvisor ? (
                  <p>
                    本服務為證券投資顧問服務，提供之分析意見與建議僅供參考，不保證獲利。
                    投資一定有風險，申購前應詳閱相關法規及風險揭露說明。
                    <strong className="block mt-2">過去績效不代表未來表現，投資有風險，請謹慎評估。</strong>
                  </p>
                ) : (
                  <p>
                    本服務所有內容均至少延遲 7 天發布，僅作為歷史案例教學之用途，
                    不構成任何即時投資建議。
                    <strong className="block mt-2">過去績效不代表未來表現，投資有風險，請謹慎評估。</strong>
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  );
};

export default ExpertProfile;
