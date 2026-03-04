import { useParams, Link } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
import { ExpertRole } from '@/types';
import { CheckCircle, ArrowRight, Shield, Clock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePlan } from '@/hooks/useExpertPlans';

const PlanDetail = () => {
  const { slug, planId } = useParams<{ slug: string; planId: string }>();
  const { data: planData, isLoading } = usePlan(planId);

  if (isLoading) {
    return (
      <PortalLayout>
        <div className="container py-12 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </PortalLayout>
    );
  }

  if (!planData || !planData.experts) {
    return (
      <PortalLayout>
        <div className="container py-12 text-center">
          <h1 className="text-2xl font-bold mb-4">找不到此方案</h1>
          <Button asChild><Link to="/experts">返回專家列表</Link></Button>
        </div>
      </PortalLayout>
    );
  }

  const expert = planData.experts as any;
  const isAdvisor = expert.role === 'advisor';
  const role: ExpertRole = isAdvisor ? 'advisor' : 'mentor';

  const getPlanFeatures = (planType: string): string[] => {
    switch (planType) {
      case 'analyst_signal_l1': return ['即時策略訊號（透過 LINE OA）', '策略教學頁面', '交易紀錄查詢', '風險與部位控管說明'];
      case 'analyst_signal_diag_l2': return ['等級 1 所有功能', '持股診斷報告', '個人化投資組合建議', '專屬風險評估'];
      case 'mentor_weekly_journal': return ['每週六修煉派週記', '完整操作邏輯拆解', '策略教學內容', '問題統整 Q&A（非個別建議）'];
      default: return [];
    }
  };

  const formatPrice = (price: number) => new Intl.NumberFormat('zh-TW').format(price);

  return (
    <PortalLayout>
      <div className="container py-8 md:py-12 max-w-3xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <img src={expert.avatar_url || '/placeholder.svg'} alt={expert.name} className={cn("h-16 w-16 rounded-full object-cover ring-2", isAdvisor ? "ring-advisor/20" : "ring-mentor/20")} />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{expert.name}</h1>
              <RoleBadge role={role} />
            </div>
            <p className="text-muted-foreground">{expert.bio || ''}</p>
          </div>
        </div>

        {/* Plan Card */}
        <Card className={cn("border-2 overflow-hidden", isAdvisor ? "border-advisor/30" : "border-mentor/30")}>
          <div className={cn("h-1.5", isAdvisor ? "gradient-advisor" : "gradient-mentor")} />
          <CardContent className="p-6 md:p-8">
            <Badge variant={isAdvisor ? 'advisor' : 'mentor'} className="mb-4">{planData.name}</Badge>
            
            <h2 className="text-2xl font-bold mb-2">{planData.name}</h2>
            <p className="text-muted-foreground mb-6">{planData.description || ''}</p>

            <div className="space-y-3 mb-6">
              {getPlanFeatures(planData.plan_type).map((feature, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <CheckCircle className={cn("h-5 w-5", isAdvisor ? "text-advisor" : "text-mentor")} />
                  <span>{feature}</span>
                </div>
              ))}
            </div>

            <div className="border-t pt-6 mb-6">
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-3xl font-bold">NT$ {formatPrice(planData.price_monthly)}</span>
                <span className="text-muted-foreground">/ 月</span>
              </div>
              {planData.price_yearly && (
                <p className="text-sm text-muted-foreground">
                  年繳 NT$ {formatPrice(planData.price_yearly)} / 年（省 {Math.round((1 - planData.price_yearly / (planData.price_monthly * 12)) * 100)}%）
                </p>
              )}
            </div>

            {/* Compliance Notice */}
            <div className={cn("p-4 rounded-lg mb-6", isAdvisor ? "bg-advisor/5" : "bg-mentor/5")}>
              <div className="flex items-start gap-3">
                {isAdvisor ? <Shield className="h-5 w-5 text-advisor mt-0.5" /> : <Clock className="h-5 w-5 text-mentor mt-0.5" />}
                <div className="text-sm">
                  {isAdvisor ? (
                    <p>本服務為證券投資顧問服務，提供之分析意見與建議僅供參考，不保證獲利。投資一定有風險。</p>
                  ) : (
                    <p>本服務所有內容均至少延遲 7 天發布，僅作為歷史案例教學用途，不構成即時投資建議。</p>
                  )}
                </div>
              </div>
            </div>

            <Button variant={isAdvisor ? 'advisor' : 'mentor'} size="xl" className="w-full" asChild>
              <Link to={`/checkout/${slug}/${planId}`}>前往結帳<ArrowRight className="h-4 w-4 ml-2" /></Link>
            </Button>
          </CardContent>
        </Card>

        <div className="mt-6 text-center">
          <Link to={`/expert/${slug}`} className="text-muted-foreground hover:text-foreground text-sm">
            ← 返回 {expert.name} 的介紹頁
          </Link>
        </div>
      </div>
    </PortalLayout>
  );
};

export default PlanDetail;
