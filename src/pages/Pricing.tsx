import { Link } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, ArrowRight, Radio, BookOpen, Stethoscope, Plus, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import cardKungfuSpeed from '@/assets/card-kungfu-speed.png';
import cardKungfuBones from '@/assets/card-kungfu-bones.png';

const Pricing = () => {
  const mainPlans = [
    {
      id: 'follower',
      faction: '跟單派',
      title: '分析師即時訊號訂閱',
      icon: Radio,
      price: '1,699',
      description: '適合想把時間花在「該出手的那一刻」的人。',
      features: [
        '即時訊號',
        '策略邏輯',
        '進出場紀錄',
        '戰績回顧',
      ],
      cta: '/experts?role=advisor',
      ctaText: '選擇分析師',
      color: 'advisor',
      canAddHealth: true,
    },
    {
      id: 'cultivator',
      faction: '修煉派',
      title: '每週交易紀律與心得拆解',
      icon: BookOpen,
      price: '799',
      description: '適合想看別人怎麼做決策，慢慢練成自己的系統的人。',
      features: [
        '上週操作回顧',
        '思路拆解',
        '避雷紀律',
        '學習框架',
      ],
      cta: '/experts?role=mentor',
      ctaText: '選擇導師',
      color: 'mentor',
      canAddHealth: false,
    },
  ];

  return (
    <PortalLayout>
      <div className="container py-8 md:py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-2xl md:text-3xl font-bold mb-4">方案與價格</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
            先選門派，再決定要不要加購健檢。
          </p>
        </div>

        {/* Main Plans */}
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto mb-12">
          {mainPlans.map((plan) => {
            const isAdvisor = plan.color === 'advisor';
            return (
              <Card 
                key={plan.id}
                className={cn(
                  "relative overflow-hidden border-2 min-h-[480px]",
                  isAdvisor ? "border-advisor/30" : "border-mentor/30"
                )}
              >
                {/* Background Image */}
                {/* Background fill color matching image */}
                {isAdvisor && <div className="absolute inset-0 bg-[#1a0a0a]" />}
                <div 
                  className="absolute inset-0 bg-cover bg-no-repeat transition-all duration-500"
                  style={{ 
                    backgroundImage: `url(${isAdvisor ? cardKungfuSpeed : cardKungfuBones})`,
                    backgroundPosition: isAdvisor ? 'right -80px center' : 'center left',
                    filter: 'brightness(0.9) contrast(1.1)'
                  }}
                />
                <div className={cn(
                  "absolute inset-0",
                  isAdvisor 
                    ? "bg-gradient-to-r from-black/90 via-black/70 to-black/20" 
                    : "bg-gradient-to-l from-black/85 via-black/60 to-black/30"
                )} />
                <div className={cn(
                  "absolute top-0 left-0 right-0 h-1.5 z-10",
                  isAdvisor ? "gradient-advisor" : "gradient-mentor"
                )} />
                <CardHeader className="pb-4 relative z-10">
                  <div className={cn(
                    "h-14 w-14 rounded-xl flex items-center justify-center mb-4 backdrop-blur-sm",
                    isAdvisor ? "bg-advisor/20 ring-1 ring-advisor/30" : "bg-mentor/20 ring-1 ring-mentor/30"
                  )}>
                    <plan.icon className={cn(
                      "h-7 w-7",
                      isAdvisor ? "text-advisor" : "text-mentor"
                    )} />
                  </div>
                  <Badge 
                    variant={isAdvisor ? 'advisor' : 'mentor'}
                    className="w-fit mb-2 text-sm px-3 py-1"
                  >
                    {plan.faction}
                  </Badge>
                  <CardTitle className="text-xl text-white">{plan.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5 relative z-10">
                  <p className="text-white/80">{plan.description}</p>
                  
                  <div className="text-sm text-white/60">
                    你會拿到：
                  </div>
                  <ul className="space-y-2.5">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-center gap-2.5">
                        <CheckCircle className={cn(
                          "h-5 w-5 flex-shrink-0",
                          isAdvisor ? "text-advisor" : "text-mentor"
                        )} />
                        <span className="text-white">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="pt-2 border-t border-white/20">
                    <div className="flex items-baseline gap-1">
                      <span className="text-sm text-white/60">NT$</span>
                      <span className="text-3xl font-bold text-white">{plan.price}</span>
                      <span className="text-white/60">／月</span>
                    </div>
                  </div>

                  <Button 
                    variant={isAdvisor ? 'advisor' : 'mentor'} 
                    className="w-full"
                    size="lg"
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

        {/* Add-on Module */}
        <div className="max-w-4xl mx-auto mb-12">
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            加購模組
          </h2>
          
          <Card className="border-2 border-dashed border-advisor/40 bg-advisor-light/30">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row md:items-center gap-6">
                <div className={cn(
                  "h-14 w-14 rounded-xl flex items-center justify-center flex-shrink-0",
                  "bg-advisor-light"
                )}>
                  <Stethoscope className="h-7 w-7 text-advisor" />
                </div>
                
                <div className="flex-1">
                  <h3 className="text-lg font-bold mb-2">持股健檢（單次）</h3>
                  <p className="text-muted-foreground">
                    把你手上的持股做一次完整體檢：風險、部位、策略方向與調整建議。
                  </p>
                </div>
                
                <div className="flex flex-col items-start md:items-end gap-2">
                  <div className="flex items-baseline gap-1">
                    <span className="text-sm text-muted-foreground">NT$</span>
                    <span className="text-2xl font-bold">500</span>
                    <span className="text-muted-foreground">／次</span>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    需先訂閱「跟單派」
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Rules Section */}
        <div className="max-w-4xl mx-auto mb-12">
          <Card className="bg-muted/30">
            <CardContent className="p-6">
              <h3 className="font-bold mb-4 flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
                加購規則
              </h3>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">•</span>
                  <span>持股健檢為「單次」服務，不是月訂。</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">•</span>
                  <span>只有「跟單派」訂閱中，才可加購持股健檢。</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">•</span>
                  <span>下次想再健檢：跟單派有效期間內，可再次加購一次。</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* Purchase Flow */}
        <div className="max-w-4xl mx-auto mb-12">
          <h2 className="text-xl font-bold mb-6">購買流程</h2>
          <div className="flex flex-col md:flex-row gap-4 items-stretch">
            <div className="flex-1 relative">
              <Card className="h-full border-advisor/30">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-advisor text-advisor-foreground flex items-center justify-center font-bold text-lg flex-shrink-0">
                    1
                  </div>
                  <div>
                    <p className="font-medium">訂閱跟單派</p>
                    <p className="text-sm text-muted-foreground">NT$ 1,699／月</p>
                  </div>
                </CardContent>
              </Card>
              <div className="hidden md:flex absolute -right-4 top-1/2 -translate-y-1/2 z-10">
                <ArrowRight className="h-6 w-6 text-muted-foreground" />
              </div>
            </div>
            
            <div className="flex-1 relative">
              <Card className="h-full border-dashed border-advisor/40">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center font-bold text-lg flex-shrink-0">
                    2
                  </div>
                  <div>
                    <p className="font-medium">加購持股健檢</p>
                    <p className="text-sm text-muted-foreground">NT$ 500／次（可選）</p>
                  </div>
                </CardContent>
              </Card>
              <div className="hidden md:flex absolute -right-4 top-1/2 -translate-y-1/2 z-10">
                <ArrowRight className="h-6 w-6 text-muted-foreground" />
              </div>
            </div>
            
            <div className="flex-1">
              <Card className="h-full border-dashed border-muted-foreground/30">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center font-bold text-lg flex-shrink-0">
                    3
                  </div>
                  <div>
                    <p className="font-medium">需要第二次健檢</p>
                    <p className="text-sm text-muted-foreground">有效期間內可再加購</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div className="max-w-3xl mx-auto">
          <h2 className="text-xl font-bold mb-6 text-center">常見問題</h2>
          <div className="space-y-4">
            {[
              {
                q: '跟單派和修煉派有什麼不同？',
                a: '跟單派提供即時訊號，適合想直接跟著操作的人。修煉派則專注於教學，用上週的真實案例幫你理解決策邏輯，適合想培養自己判斷力的人。'
              },
              {
                q: '持股健檢可以買幾次？',
                a: '只要你的跟單派訂閱還在有效期間內，就可以隨時加購。每次加購都是獨立的單次服務。'
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
