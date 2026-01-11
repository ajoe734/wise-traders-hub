import { useParams, useNavigate } from "react-router-dom";
import { UnifiedAppLayout } from "@/components/layouts/UnifiedAppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ArrowLeft, Check, TrendingUp, Target, Stethoscope, Zap, BookOpen } from "lucide-react";
import { getPersonBySlug, subscriptions } from "@/data/mockData";
import { PersonRole, SubscriptionStatus, PlanType } from "@/types";
import { Link } from "react-router-dom";

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
  
  const expert = getPersonBySlug(slug || "");
  
  if (!expert) {
    return (
      <UnifiedAppLayout>
        <div className="flex flex-col items-center justify-center py-16">
          <p className="text-muted-foreground">找不到此專家</p>
          <Button variant="ghost" onClick={() => navigate("/app/explore")} className="mt-4">
            返回探索
          </Button>
        </div>
      </UnifiedAppLayout>
    );
  }

  // 根據專家角色決定顯示的方案
  const isAdvisor = expert.role === PersonRole.ADVISOR;
  const displayPlan = isAdvisor ? standardPlans.follower : standardPlans.cultivator;

  // 檢查訂閱狀態
  const userSubscriptions = subscriptions.filter(sub => sub.status === SubscriptionStatus.ACTIVE);
  
  // 檢查是否訂閱跟單派（即時策略）
  const isSubscribedToFollower = userSubscriptions.some(sub => {
    const plan = expert.plans.find(p => p.id === sub.planId);
    return plan && (plan.planType === PlanType.ANALYST_SIGNAL_L1 || plan.planType === PlanType.ANALYST_SIGNAL_DIAG_L2);
  });
  
  // 檢查是否已有持股健檢
  const hasHealthCheck = userSubscriptions.some(sub => {
    const plan = expert.plans.find(p => p.id === sub.planId);
    return plan && plan.planType === PlanType.ANALYST_SIGNAL_DIAG_L2;
  });
  
  // 檢查是否訂閱修煉派
  const isSubscribedToCultivator = userSubscriptions.some(sub => {
    const plan = expert.plans.find(p => p.id === sub.planId);
    return plan && plan.planType === PlanType.MENTOR_WEEKLY_JOURNAL;
  });

  // 判斷是否已訂閱此專家的對應方案
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
          返回探索
        </Button>

        {/* Expert Header */}
        <div className="flex items-start gap-4">
          <Avatar className="h-20 w-20 border-2 border-primary/20">
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
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-2 text-primary">
                <Check className="h-4 w-4" />
                <span className="font-medium">已訂閱此專家</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                可在{isAdvisor ? '訊號中心' : '週記中心'}查看此專家的最新內容
              </p>
            </CardContent>
          </Card>
        )}

        {/* Performance Summary */}
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            績效摘要
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardContent className="py-3 px-4 text-center">
                <p className="text-2xl font-bold text-green-500">
                  +{performanceData.cumulativeReturn}%
                </p>
                <p className="text-xs text-muted-foreground">累積報酬</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4 text-center">
                <p className="text-2xl font-bold text-primary">
                  +{performanceData.annualizedReturn}%
                </p>
                <p className="text-xs text-muted-foreground">年化報酬</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4 text-center">
                <p className="text-2xl font-bold">
                  {performanceData.winRate}%
                </p>
                <p className="text-xs text-muted-foreground">勝率</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4 text-center">
                <p className="text-2xl font-bold">
                  {performanceData.totalTrades}
                </p>
                <p className="text-xs text-muted-foreground">總交易數</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Subscription Plan - 統一定價顯示 */}
        {!isSubscribed && (
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
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
                  className="w-full" 
                  onClick={() => navigate('/pricing')}
                >
                  立即訂閱
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 持股健檢加購 - 只對已訂閱跟單派但尚未加購健檢的用戶顯示 */}
        {isSubscribedToFollower && !hasHealthCheck && isAdvisor && (
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Stethoscope className="h-5 w-5 text-advisor" />
              加購服務
            </h2>
            <Card className="border-2 border-dashed border-advisor/40 bg-advisor/5">
              <CardContent className="p-4">
                <div className="flex items-start gap-3 mb-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-advisor/10 text-advisor">
                    <Stethoscope className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold">{standardPlans.healthCheck.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {standardPlans.healthCheck.description}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold">NT$ {standardPlans.healthCheck.price}</span>
                    <span className="text-sm text-muted-foreground">/次</span>
                  </div>
                  <Button 
                    variant="outline" 
                    className="border-advisor text-advisor hover:bg-advisor hover:text-white"
                    onClick={() => navigate('/pricing')}
                  >
                    加購
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Already subscribed - show manage link */}
        {isSubscribed && (
          <div className="text-center pt-4">
            <Link 
              to="/app/account" 
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              管理訂閱方案 →
            </Link>
          </div>
        )}
      </div>
    </UnifiedAppLayout>
  );
};

export default AppExpertDetail;
