import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { UnifiedAppLayout } from "@/components/layouts/UnifiedAppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ArrowLeft, Check, Target, Zap, BookOpen, Lock } from "lucide-react";

import { ExpertRole } from "@/types";
import { Link } from "react-router-dom";
import { PerformanceOverviewPanel } from "@/components/strategy/PerformanceOverviewPanel";
import { supabase } from "@/integrations/supabase/client";
import { useExpert } from "@/hooks/useExpert";
import { Loader2 } from "lucide-react";
import { avatarUrl } from "@/lib/imageTransform";
import { useQuery } from "@tanstack/react-query";
import { usePreviewMode } from "@/hooks/usePreviewMode";


const planMeta: Record<string, { title: string; subtitle: string; description: string; features: string[]; icon: any; variant: 'advisor' | 'mentor' }> = {
  analyst_signal_l1: {
    title: '跟單派',
    subtitle: '即時訊號通知',
    description: '每筆交易，第一時間推播通知。即時跟上，不錯失任何機會。',
    features: ['即時訊號推播通知', '完整買賣理由說明', '風險與部位控管建議'],
    icon: Zap,
    variant: 'advisor',
  },
  analyst_signal_diag_l2: {
    title: '跟單派 + 持股健檢',
    subtitle: '訊號 + 持股健檢',
    description: '包含即時訊號通知，加上個人化持股診斷服務。',
    features: ['即時訊號推播通知', '完整買賣理由說明', '持股診斷報告', '個人化投資建議'],
    icon: Zap,
    variant: 'advisor',
  },
  mentor_weekly_journal: {
    title: '修煉派',
    subtitle: 'T+7 延遲・週記式教學',
    description: '每週六由導師親自發布週記，所有內容均延遲 7 天以上。專注學習策略邏輯與操作紀律，非即時投資建議。',
    features: ['T+7 延遲實戰週記', '完整操作邏輯拆解', '事後檢討與學習重點'],
    icon: BookOpen,
    variant: 'mentor',
  },
};

interface DbPlan {
  id: string;
  plan_type: string;
  price_monthly: number;
  name: string;
  description: string | null;
}

const AppExpertDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [subscribedPlanTypes, setSubscribedPlanTypes] = useState<string[]>([]);
  
  const { data: expert, isLoading } = useExpert(slug);
  

  // Fetch expert plans from DB
  const { data: dbPlans = [] } = useQuery({
    queryKey: ['expert-plans-detail', slug],
    queryFn: async () => {
      if (!slug) return [];
      const { data: dbExpert } = await supabase.from("experts").select("id").eq("slug", slug).single();
      if (!dbExpert) return [];
      const { data: plans } = await supabase
        .from("expert_plans")
        .select("id, plan_type, price_monthly, name, description")
        .eq("expert_id", dbExpert.id)
        .eq("is_active", true)
        .order("price_monthly");
      return (plans || []) as DbPlan[];
    },
    enabled: !!slug,
    staleTime: 60_000,
  });

  useEffect(() => {
    const fetchSubscription = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !slug) return;

      const { data: subs } = await supabase
        .from("member_subscriptions")
        .select("plan_id, expert_plans(plan_type)")
        .eq("user_id", user.id)
        .eq("status", "active");

      const types = (subs || []).filter((s: any) => s.expert_plans).map((s: any) => s.expert_plans.plan_type as string);
      setSubscribedPlanTypes(types);
    };
    fetchSubscription();
  }, [slug]);

  if (isLoading) {
    return <UnifiedAppLayout><div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div></UnifiedAppLayout>;
  }

  if (!expert) {
    return (
      <UnifiedAppLayout>
        <div className="flex flex-col items-center justify-center py-16">
          <p className="text-muted-foreground">找不到此專家</p>
          <Button variant="ghost" onClick={() => navigate("/app")} className="mt-4">返回戰情室</Button>
        </div>
      </UnifiedAppLayout>
    );
  }

  const isAdvisor = expert.role === 'advisor';
  // Use first DB plan, fallback to meta
  const mainPlan = dbPlans[0] || null;
  const mainMeta = mainPlan ? planMeta[mainPlan.plan_type] : (isAdvisor ? planMeta.analyst_signal_l1 : planMeta.mentor_weekly_journal);

  const { isPreview, previewSlug } = usePreviewMode();
  const previewMatch = isPreview && previewSlug === slug;
  const isSubscribedToFollower = previewMatch || subscribedPlanTypes.some(t => t === 'analyst_signal_l1' || t === 'analyst_signal_diag_l2');
  const hasHealthCheck = previewMatch || subscribedPlanTypes.includes('analyst_signal_diag_l2');
  const isSubscribedToCultivator = previewMatch || subscribedPlanTypes.includes('mentor_weekly_journal');
  const isSubscribed = isAdvisor ? isSubscribedToFollower : isSubscribedToCultivator;

  const getRoleLabel = (role: ExpertRole) => role === 'advisor' ? "投顧分析師" : "實戰導師";
  const getRoleBadgeVariant = (role: ExpertRole) => role === 'advisor' ? "default" as const : "secondary" as const;

  const PlanIcon = mainMeta?.icon || Zap;

  return (
    <UnifiedAppLayout>
      <div className="p-4 space-y-6 pb-24">
        <Button variant="ghost" size="sm" onClick={() => navigate("/app/explore")} className="gap-2 -ml-2">
          <ArrowLeft className="h-4 w-4" />返回探索名師
        </Button>

        <div className="flex items-start gap-4">
          <Avatar className={`h-20 w-20 border-2 ${isAdvisor ? 'border-advisor/20' : 'border-mentor/20'}`}>
            <AvatarImage src={avatarUrl(expert.avatarUrl, 160)} alt={expert.name} loading="lazy" decoding="async" className="object-[center_15%]" />
            <AvatarFallback>{expert.name[0]}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-bold">{expert.name}</h1>
              <Badge variant={getRoleBadgeVariant(expert.role)}>{getRoleLabel(expert.role)}</Badge>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{expert.bio}</p>
            {expert.styleTags && expert.styleTags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {expert.styleTags.map((tag, idx) => <Badge key={idx} variant="outline" className="text-xs">{tag}</Badge>)}
              </div>
            )}
          </div>
        </div>

        {isSubscribed && (
          <Card className={`${isAdvisor ? 'border-advisor/30 bg-advisor/5' : 'border-mentor/30 bg-mentor/5'}`}>
            <CardContent className="py-3 px-4">
              <div className={`flex items-center gap-2 ${isAdvisor ? 'text-advisor' : 'text-mentor'}`}>
                <Check className="h-4 w-4" /><span className="font-medium">已訂閱此專家</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">可在{isAdvisor ? '訊號中心' : '週記中心'}查看此專家的最新內容</p>
            </CardContent>
          </Card>
        )}


        <div className="pt-2">
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2 text-muted-foreground">
            <Target className="h-4 w-4" />績效總覽
          </h2>
          <PerformanceOverviewPanel expertId={expert.id} startingCapital={(expert as any).startingCapital ?? null} variant={isAdvisor ? 'advisor' : 'mentor'} />
        </div>

        {!isSubscribed && mainPlan && mainMeta && (
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Target className={`h-5 w-5 ${isAdvisor ? 'text-advisor' : 'text-mentor'}`} />訂閱方案
            </h2>
            <Card className={`overflow-hidden border-2 ${isAdvisor ? 'border-advisor/30' : 'border-mentor/30'}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3 mb-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${isAdvisor ? 'bg-advisor/10 text-advisor' : 'bg-mentor/10 text-mentor'}`}>
                    <PlanIcon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-lg">{mainMeta.title}</h3>
                      <Badge variant="outline" className="text-xs">{mainMeta.subtitle}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{mainPlan.description || mainMeta.description}</p>
                  </div>
                </div>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-3xl font-bold">NT$ {mainPlan.price_monthly.toLocaleString()}</span>
                  <span className="text-sm text-muted-foreground">/月</span>
                </div>
                <ul className="space-y-2 mb-4">
                  {mainMeta.features.map((feature, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-sm">
                      <Check className={`h-4 w-4 shrink-0 ${isAdvisor ? 'text-advisor' : 'text-mentor'}`} /><span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button className={`w-full ${isAdvisor ? 'bg-advisor hover:bg-advisor/90' : 'bg-mentor hover:bg-mentor/90'} text-white`} onClick={() => navigate(`/expert/${slug}`)}>
                  立即訂閱
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Health check add-on removed — use full checkout page instead */}
      </div>
    </UnifiedAppLayout>
  );
};

export default AppExpertDetail;
