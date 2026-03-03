import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { UnifiedAppLayout } from "@/components/layouts/UnifiedAppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ArrowLeft, Check, TrendingUp, Target, Stethoscope, Zap, BookOpen, Lock } from "lucide-react";
import { getPersonBySlug } from "@/data/mockData";
import { PersonRole } from "@/types";
import { Link } from "react-router-dom";
import { PerformanceOverviewPanel } from "@/components/strategy/PerformanceOverviewPanel";
import { supabase } from "@/integrations/supabase/client";

// 統一定價結構（與 Pricing.tsx 一致）
const standardPlans = {
  follower: {
    id: 'follower',
    title: '跟單派',
    subtitle: '即時訊號通知',
    description: '每筆交易，第一時間推播通知。即時跟上，不錯失任何機會。',
    priceMonthly: 1699,
    features: [
      '即時訊號推播通知',
      '完整買賣理由說明',
      '風險與部位控管建議',
    ],
    icon: Zap,
    variant: 'advisor' as const,
  },
  cultivator: {
    id: 'cultivator',
    title: '修煉派',
    subtitle: 'T+7 延遲・週記式教學',
    description: '每週一篇週記，回顧一週前的實戰操作。透過延遲的資訊，專注學習策略邏輯。',
    priceMonthly: 799,
    features: [
      '每週實戰週記',
      '完整操作邏輯拆解',
      '事後檢討與學習重點',
    ],
    icon: BookOpen,
    variant: 'mentor' as const,
  },
  healthCheck: {
    id: 'health-check',
    title: '持股健檢',
    subtitle: '單次加購',
    description: '把你手上的持股做一次完整體檢：風險、部位、策略方向與調整建議。',
    price: 500,
    requiresFollower: true,
  }
};

const AppExpertDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [subscribedPlanTypes, setSubscribedPlanTypes] = useState<string[]>([]);
  
  const expert = getPersonBySlug(slug || "");

  useEffect(() => {
    const fetchSubscription = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !expert) return;
      
      // Get expert's DB id by slug
      const { data: dbExpert } = await supabase
        .from("experts")
        .select("id")
        .eq("slug", slug || "")
        .single();
      if (!dbExpert) return;

      // Get user's active subscriptions for this expert
      const { data: subs } = await supabase
        .from("member_subscriptions")
        .select("plan_id, expert_plans(plan_type)")
        .eq("user_id", user.id)
        .eq("status", "active");

      const types = (subs || [])
        .filter((s: any) => s.expert_plans)
        .map((s: any) => s.expert_plans.plan_type as string);
      setSubscribedPlanTypes(types);
    };
    fetchSubscription();
  }, [slug, expert]);

  if (!expert) {
    return (
      <UnifiedAppLayout>
        <div className="flex flex-col items-center justify-center py-16">
          <p className="text-muted-foreground">找不到此專家</p>
          <Button variant="ghost" onClick={() => navigate("/app")} className="mt-4">
            返回戰情室
          </Button>
        </div>
      </UnifiedAppLayout>
    );
  }

  // 根據專家角色決定顯示的方案
  const isAdvisor = expert.role === PersonRole.ADVISOR;
  const displayPlan = isAdvisor ? standardPlans.follower : standardPlans.cultivator;

  // 檢查訂閱狀態 (from DB)
  const isSubscribedToFollower = subscribedPlanTypes.some(t => 
    t === 'analyst_signal_l1' || t === 'analyst_signal_diag_l2'
  );
  const hasHealthCheck = subscribedPlanTypes.includes('analyst_signal_diag_l2');
  const isSubscribedToCultivator = subscribedPlanTypes.includes('mentor_weekly_journal');
  const isSubscribed = isAdvisor ? isSubscribedToFollower : isSubscribedToCultivator;

  const getRoleLabel = (role: PersonRole) => {
    return role === PersonRole.ADVISOR ? "投顧分析師" : "實戰導師";
  };

  const getRoleBadgeVariant = (role: PersonRole) => {
    return role === PersonRole.ADVISOR ? "default" : "secondary";
  };

  // Mock performance data
  const performanceData = {
    cumulativeReturn: 128.5,
    annualizedReturn: 45.2,
    winRate: 72,
    totalTrades: 156
  };

  const PlanIcon = displayPlan.icon;

  return (
    <UnifiedAppLayout>
      <div className="p-4 space-y-6 pb-24">
        {/* Back button */}
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => navigate("/app/explore")}
          className="gap-2 -ml-2"
        >
          <ArrowLeft className="h-4 w-4" />
          返回探索名師
        </Button>

        {/* Expert Header */}
        <div className="flex items-start gap-4">
          <Avatar className={`h-20 w-20 border-2 ${isAdvisor ? 'border-advisor/20' : 'border-mentor/20'}`}>
            <AvatarImage src={expert.avatarUrl} alt={expert.name} />
            <AvatarFallback>{expert.name[0]}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-bold">{expert.name}</h1>
              <Badge variant={getRoleBadgeVariant(expert.role)}>
                {getRoleLabel(expert.role)}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {expert.bio}
            </p>
            {expert.styleTags && expert.styleTags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {expert.styleTags.map((tag, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Subscription Status */}
        {isSubscribed && (
          <Card className={`${isAdvisor ? 'border-advisor/30 bg-advisor/5' : 'border-mentor/30 bg-mentor/5'}`}>
            <CardContent className="py-3 px-4">
              <div className={`flex items-center gap-2 ${isAdvisor ? 'text-advisor' : 'text-mentor'}`}>
                <Check className="h-4 w-4" />
                <span className="font-medium">已訂閱此專家</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                可在{isAdvisor ? '訊號中心' : '週記中心'}查看此專家的最新內容
              </p>
            </CardContent>
          </Card>
        )}

        {/* Performance Overview Panel */}
        <div className="pt-2">
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="h-4 w-4" />
            績效總覽
          </h2>
          <PerformanceOverviewPanel expertSlug={slug || ""} variant={isAdvisor ? 'advisor' : 'mentor'} />
        </div>

        {/* Subscription Plan - 統一定價顯示 */}
        {!isSubscribed && (
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Target className={`h-5 w-5 ${isAdvisor ? 'text-advisor' : 'text-mentor'}`} />
              訂閱方案
            </h2>
            <Card className={`overflow-hidden border-2 ${isAdvisor ? 'border-advisor/30' : 'border-mentor/30'}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3 mb-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${isAdvisor ? 'bg-advisor/10 text-advisor' : 'bg-mentor/10 text-mentor'}`}>
                    <PlanIcon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-lg">{displayPlan.title}</h3>
                      <Badge variant="outline" className="text-xs">
                        {displayPlan.subtitle}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {displayPlan.description}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-3xl font-bold">
                    NT$ {displayPlan.priceMonthly.toLocaleString()}
                  </span>
                  <span className="text-sm text-muted-foreground">/月</span>
                </div>

                <ul className="space-y-2 mb-4">
                  {displayPlan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-sm">
                      <Check className={`h-4 w-4 shrink-0 ${isAdvisor ? 'text-advisor' : 'text-mentor'}`} />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button 
                  className={`w-full ${isAdvisor ? 'bg-advisor hover:bg-advisor/90' : 'bg-mentor hover:bg-mentor/90'} text-white`}
                  onClick={() => navigate(`/expert/${slug}`)}
                >
                  立即訂閱
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 持股健檢區塊 - 未加購時顯示 */}
        {!hasHealthCheck && (
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Stethoscope className={`h-5 w-5 ${isAdvisor ? 'text-advisor' : 'text-mentor'}`} />
              加購服務
            </h2>
            <Card className={`border-2 border-dashed ${
              isSubscribed
                ? isAdvisor ? 'border-advisor/40 bg-advisor/5' : 'border-mentor/40 bg-mentor/5'
                : 'border-muted bg-muted/30'
            }`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3 mb-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    isSubscribed
                      ? isAdvisor ? 'bg-advisor/10 text-advisor' : 'bg-mentor/10 text-mentor'
                      : 'bg-muted text-muted-foreground'
                  }`}>
                    {isSubscribed ? (
                      <Stethoscope className="h-5 w-5" />
                    ) : (
                      <Lock className="h-5 w-5" />
                    )}
                  </div>
                  <div className="flex-1">
                    <h3 className={`font-semibold ${!isSubscribed && 'text-muted-foreground'}`}>
                      {standardPlans.healthCheck.title}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {standardPlans.healthCheck.description}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-baseline gap-1">
                    <span className={`text-2xl font-bold ${!isSubscribed && 'text-muted-foreground'}`}>
                      NT$ {standardPlans.healthCheck.price}
                    </span>
                    <span className="text-sm text-muted-foreground">/次</span>
                  </div>
                  {isSubscribed ? (
                    <Button 
                      variant="outline" 
                      className={isAdvisor 
                        ? "border-advisor text-advisor hover:bg-advisor hover:text-white" 
                        : "border-mentor text-mentor hover:bg-mentor hover:text-white"}
                      onClick={() => navigate(`/expert/${slug}`)}
                    >
                      加購
                    </Button>
                  ) : (
                    <Button variant="outline" disabled className="text-muted-foreground">
                      訂閱後解鎖
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

      </div>
    </UnifiedAppLayout>
  );
};

export default AppExpertDetail;
