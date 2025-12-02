import { useParams, Link } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
import { getPersonBySlug } from '@/data/mockData';
import { PersonRole, PlanType } from '@/types';
import { CheckCircle, AlertTriangle, ArrowRight, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

const PersonProfile = () => {
  const { slug } = useParams<{ slug: string }>();
  const person = slug ? getPersonBySlug(slug) : undefined;

  if (!person) {
    return (
      <PortalLayout>
        <div className="container py-12 text-center">
          <h1 className="text-2xl font-bold mb-4">找不到此專家</h1>
          <Button asChild>
            <Link to="/explore">返回探索頁</Link>
          </Button>
        </div>
      </PortalLayout>
    );
  }

  const isAdvisor = person.role === PersonRole.ADVISOR;

  const getPlanInfo = (planType: PlanType) => {
    switch (planType) {
      case PlanType.ANALYST_SIGNAL_L1:
        return {
          title: '分析師即時策略訂閱',
          description: '即時策略訊號＋每筆操作的教學解說。訊號會出現在會員 app 的「即時訊號牆」，未來可透過 LINE 通知。',
          features: ['即時策略訊號推播', '每筆操作附帶教學說明', '風險與部位控管解說'],
          note: '包含具體買賣指示，屬投顧服務，須依規範辦理。'
        };
      case PlanType.ANALYST_SIGNAL_DIAG_L2:
        return {
          title: '分析師策略＋持股健檢',
          description: '包含即時訊號與教學，加上持股上傳與診斷報告服務。',
          features: ['所有 L1 功能', '持股健檢報告', '個人化投資組合建議'],
          note: '包含具體買賣指示與個人化診斷，屬投顧服務。'
        };
      case PlanType.MENTOR_WEEKLY_JOURNAL:
        return {
          title: '實戰週記教學訂閱（T+7）',
          description: '每週一次，回顧「一週前」的實戰或模擬操作。顯示買賣紀錄、當時理由、事後檢討。所有內容至少延遲 7 天，僅供歷史案例教學。',
          features: ['每週實戰週記', '完整操作邏輯拆解', '事後檢討與學習重點'],
          note: '所有內容至少延遲 7 天發布，不提供即時訊號，不提供個股診斷。'
        };
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('zh-TW').format(price);
  };

  return (
    <PortalLayout>
      <div className="container py-8 md:py-12">
        {/* Header */}
        <div className="flex flex-col md:flex-row gap-6 items-start mb-12">
          <img
            src={person.avatarUrl || '/placeholder.svg'}
            alt={person.name}
            className={cn(
              "h-24 w-24 md:h-32 md:w-32 rounded-2xl object-cover ring-4",
              isAdvisor ? "ring-advisor/20" : "ring-mentor/20"
            )}
          />
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <h1 className="text-2xl md:text-3xl font-bold">{person.name}</h1>
              <RoleBadge role={person.role} size="lg" />
            </div>
            <p className="text-lg text-muted-foreground mb-4">{person.bio}</p>
            <p className="text-muted-foreground">{person.description}</p>
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
                  {person.styleTags.map(tag => (
                    <Badge key={tag} variant="secondary">{tag}</Badge>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">主要市場</p>
                  <div className="flex flex-wrap gap-1">
                    {person.markets.map(market => (
                      <Badge key={market} variant="outline">{market}</Badge>
                    ))}
                  </div>
                </div>
                {person.riskTolerance && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">風險偏好</p>
                    <p className="font-medium">{person.riskTolerance}</p>
                  </div>
                )}
              </div>
              {person.timeframe && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">操作週期</p>
                  <p className="font-medium">{person.timeframe}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">交易系統</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {person.tradingSystems.map(system => (
                <div key={system.id} className="p-3 rounded-lg bg-muted/50">
                  <p className="font-medium mb-1">{system.name}</p>
                  <p className="text-sm text-muted-foreground">{system.description}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Plans Section */}
        <div id="plans" className="scroll-mt-20">
          <h2 className="text-xl md:text-2xl font-bold mb-6">訂閱方案</h2>
          <div className="grid md:grid-cols-2 gap-6">
            {person.plans.filter(p => p.isActive).map(plan => {
              const info = getPlanInfo(plan.planType);
              return (
                <Card 
                  key={plan.id}
                  className={cn(
                    "relative overflow-hidden border-2",
                    isAdvisor ? "border-advisor/20 hover:border-advisor/40" : "border-mentor/20 hover:border-mentor/40"
                  )}
                >
                  <div className={cn(
                    "absolute top-0 left-0 right-0 h-1",
                    isAdvisor ? "gradient-advisor" : "gradient-mentor"
                  )} />
                  <CardHeader>
                    <CardTitle className="text-lg">{info.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-muted-foreground text-sm">{info.description}</p>
                    
                    <ul className="space-y-2">
                      {info.features.map((feature, idx) => (
                        <li key={idx} className="flex items-center gap-2 text-sm">
                          <CheckCircle className={cn(
                            "h-4 w-4",
                            isAdvisor ? "text-advisor" : "text-mentor"
                          )} />
                          {feature}
                        </li>
                      ))}
                    </ul>

                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold">NT$ {formatPrice(plan.priceMonthly)}</span>
                      <span className="text-muted-foreground">/ 月</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      年繳 NT$ {formatPrice(plan.priceYearly)}（省 {Math.round((1 - plan.priceYearly / (plan.priceMonthly * 12)) * 100)}%）
                    </p>

                    <div className={cn(
                      "flex items-start gap-2 p-3 rounded-lg text-sm",
                      isAdvisor ? "bg-advisor-light/50 text-advisor" : "bg-mentor-light/50 text-mentor"
                    )}>
                      <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>{info.note}</span>
                    </div>

                    <Button 
                      variant={isAdvisor ? 'advisor' : 'mentor'} 
                      className="w-full"
                      asChild
                    >
                      <Link to={`/checkout/${plan.id}`}>
                        訂閱此方案
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
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
                    本公司已依法取得證券投資顧問事業營業執照。
                  </p>
                ) : (
                  <p>
                    本服務所有內容均至少延遲 7 天發布，僅作為歷史案例教學之用途，
                    不構成任何即時投資建議，也不提供個別持股診斷。
                    投資決策請自行判斷，風險自負。
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

export default PersonProfile;
