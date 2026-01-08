import { useParams, useNavigate } from "react-router-dom";
import { UnifiedAppLayout } from "@/components/layouts/UnifiedAppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ArrowLeft, Check, TrendingUp, Target, Award } from "lucide-react";
import { getPersonBySlug, subscriptions } from "@/data/mockData";
import { PersonRole, SubscriptionStatus } from "@/types";
import { Link } from "react-router-dom";

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

  // Check subscription status - find if user has active subscription to any of this expert's plans
  const expertPlanIds = expert.plans.map(p => p.id);
  const isSubscribed = subscriptions.some(
    sub => expertPlanIds.includes(sub.planId) && sub.status === SubscriptionStatus.ACTIVE
  );

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
              <Button 
                className="w-full mt-3" 
                onClick={() => navigate(`/line/${expert.slug}/home`)}
              >
                {expert.role === PersonRole.ADVISOR ? '進入分析師專區' : '進入導師專區'}
              </Button>
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

        {/* Subscription Plans */}
        {!isSubscribed && expert.plans && expert.plans.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              訂閱方案
            </h2>
            <div className="space-y-3">
              {expert.plans.map((plan) => (
                <Card key={plan.id} className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="font-semibold">{plan.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {plan.description}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-baseline gap-1 mb-3">
                      <span className="text-2xl font-bold">
                        NT$ {plan.priceMonthly.toLocaleString()}
                      </span>
                      <span className="text-sm text-muted-foreground">/月</span>
                    </div>

                    {plan.features && (
                      <ul className="space-y-1 mb-4">
                        {plan.features.slice(0, 3).map((feature, idx) => (
                          <li key={idx} className="flex items-center gap-2 text-sm">
                            <Check className="h-3 w-3 text-green-500 shrink-0" />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <Button 
                      className="w-full" 
                      onClick={() => navigate(`/app/checkout/${expert.slug}/${plan.id}`)}
                    >
                      立即訂閱
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
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
