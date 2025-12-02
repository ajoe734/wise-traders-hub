import { Link } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, X, ArrowRight, Radio, BookOpen, Stethoscope } from 'lucide-react';
import { cn } from '@/lib/utils';

const Pricing = () => {
  const plans = [
    {
      id: 'l1',
      title: '分析師即時策略訂閱',
      provider: '投顧分析師',
      providerColor: 'advisor',
      icon: Radio,
      price: '1,499 ~ 1,999',
      description: '適合想跟隨專業分析師即時操作的投資人',
      features: [
        { text: '即時策略訊號', included: true },
        { text: '每筆操作教學說明', included: true },
        { text: '風險與部位控管解說', included: true },
        { text: '持股健檢報告', included: false },
        { text: 'T+7 週記教學', included: false },
      ],
      cta: '/explore?role=advisor',
      ctaText: '查看投顧分析師',
    },
    {
      id: 'l2',
      title: '分析師策略＋持股健檢',
      provider: '投顧分析師',
      providerColor: 'advisor',
      icon: Stethoscope,
      price: '2,999 ~ 3,999',
      description: '適合需要個人化投資組合建議的投資人',
      popular: true,
      features: [
        { text: '即時策略訊號', included: true },
        { text: '每筆操作教學說明', included: true },
        { text: '風險與部位控管解說', included: true },
        { text: '持股健檢報告', included: true },
        { text: 'T+7 週記教學', included: false },
      ],
      cta: '/explore?role=advisor',
      ctaText: '查看投顧分析師',
    },
    {
      id: 'journal',
      title: '實戰週記教學訂閱',
      provider: '實戰導師',
      providerColor: 'mentor',
      icon: BookOpen,
      price: '799 ~ 999',
      description: '適合想從歷史案例學習操作思維的投資人',
      features: [
        { text: '即時策略訊號', included: false },
        { text: '每筆操作教學說明', included: true, note: 'T+7 延遲' },
        { text: '風險與部位控管解說', included: true },
        { text: '持股健檢報告', included: false },
        { text: 'T+7 週記教學', included: true },
      ],
      cta: '/explore?role=mentor',
      ctaText: '查看實戰導師',
    },
  ];

  return (
    <PortalLayout>
      <div className="container py-8 md:py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-2xl md:text-3xl font-bold mb-4">方案與價格</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            選擇適合你的訂閱方案，開始你的投資學習之旅
          </p>
        </div>

        {/* Plans */}
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto mb-12">
          {plans.map((plan) => {
            const isAdvisor = plan.providerColor === 'advisor';
            return (
              <Card 
                key={plan.id}
                className={cn(
                  "relative overflow-hidden border-2",
                  plan.popular && "ring-2 ring-primary",
                  isAdvisor ? "border-advisor/20" : "border-mentor/20"
                )}
              >
                {plan.popular && (
                  <div className="absolute top-4 right-4">
                    <Badge>最熱門</Badge>
                  </div>
                )}
                <div className={cn(
                  "absolute top-0 left-0 right-0 h-1",
                  isAdvisor ? "gradient-advisor" : "gradient-mentor"
                )} />
                <CardHeader className="pb-4">
                  <div className={cn(
                    "h-12 w-12 rounded-xl flex items-center justify-center mb-4",
                    isAdvisor ? "bg-advisor-light" : "bg-mentor-light"
                  )}>
                    <plan.icon className={cn(
                      "h-6 w-6",
                      isAdvisor ? "text-advisor" : "text-mentor"
                    )} />
                  </div>
                  <Badge 
                    variant={isAdvisor ? 'advisor-light' : 'mentor-light'}
                    className="w-fit mb-2"
                  >
                    {plan.provider}
                  </Badge>
                  <CardTitle className="text-lg">{plan.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{plan.description}</p>
                  
                  <div className="flex items-baseline gap-1">
                    <span className="text-sm text-muted-foreground">NT$</span>
                    <span className="text-2xl font-bold">{plan.price}</span>
                    <span className="text-muted-foreground">/ 月</span>
                  </div>

                  <ul className="space-y-3">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm">
                        {feature.included ? (
                          <CheckCircle className={cn(
                            "h-4 w-4 mt-0.5",
                            isAdvisor ? "text-advisor" : "text-mentor"
                          )} />
                        ) : (
                          <X className="h-4 w-4 mt-0.5 text-muted-foreground/50" />
                        )}
                        <span className={cn(!feature.included && "text-muted-foreground/50")}>
                          {feature.text}
                          {feature.note && (
                            <span className="text-xs text-muted-foreground ml-1">
                              ({feature.note})
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <Button 
                    variant={isAdvisor ? 'advisor' : 'mentor'} 
                    className="w-full"
                    asChild
                  >
                    <Link to={plan.cta}>
                      {plan.ctaText}
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* FAQ */}
        <div className="max-w-3xl mx-auto">
          <h2 className="text-xl font-bold mb-6 text-center">常見問題</h2>
          <div className="space-y-4">
            {[
              {
                q: '投顧分析師和實戰導師有什麼不同？',
                a: '投顧分析師持有合法執照，可以提供即時的投資建議與策略訊號。實戰導師則專注於教學，所有內容都至少延遲 7 天發布，作為歷史案例學習之用。'
              },
              {
                q: '什麼是 T+7？',
                a: 'T+7 表示內容至少延遲 7 天發布。例如，今天發布的週記是回顧一週前的操作，確保所有內容都是歷史資料，僅供教學參考。'
              },
              {
                q: '可以隨時取消訂閱嗎？',
                a: '是的，您可以隨時取消訂閱。取消後，您仍可使用服務至當期結束。'
              },
              {
                q: '訊號會透過什麼方式通知？',
                a: '目前訊號會顯示在會員 app 的「即時訊號牆」中。未來我們將支援 LINE 推播通知。'
              },
            ].map((faq, idx) => (
              <Card key={idx}>
                <CardContent className="p-5">
                  <h3 className="font-semibold mb-2">{faq.q}</h3>
                  <p className="text-sm text-muted-foreground">{faq.a}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </PortalLayout>
  );
};

export default Pricing;
