import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { CheckCircle, ArrowRight, Radio, BookOpen, Stethoscope, Plus, AlertCircle, Zap, Clock, Target, Lightbulb, Eye, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import cardKungfuSpeed from '@/assets/card-kungfu-speed.png';
import cardKungfuBones from '@/assets/card-kungfu-bones.png';

const Pricing = () => {
  const [exampleModalOpen, setExampleModalOpen] = useState(false);
  const [activeExample, setActiveExample] = useState<'follower' | 'cultivator' | null>(null);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  
  const followerCardRef = useRef<HTMLDivElement>(null);
  const cultivatorCardRef = useRef<HTMLDivElement>(null);

  const openExample = (type: 'follower' | 'cultivator') => {
    setActiveExample(type);
    setExampleModalOpen(true);
  };

  const handlePillClick = (cardType: 'follower' | 'cultivator') => {
    const targetRef = cardType === 'follower' ? followerCardRef : cultivatorCardRef;
    const cardId = cardType === 'follower' ? 'follower' : 'cultivator';
    
    // Expand the clicked card, collapse the other
    setExpandedCard(cardId);
    
    // Smooth scroll to card
    setTimeout(() => {
      targetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    
    // Add highlight effect
    setTimeout(() => {
      if (targetRef.current) {
        targetRef.current.classList.add('ring-2', 'ring-offset-2', 'shadow-xl');
        if (cardType === 'follower') {
          targetRef.current.classList.add('ring-advisor');
        } else {
          targetRef.current.classList.add('ring-mentor');
        }
        
        setTimeout(() => {
          targetRef.current?.classList.remove('ring-2', 'ring-offset-2', 'ring-advisor', 'ring-mentor', 'shadow-xl');
        }, 800);
      }
    }, 400);
  };

  const mainPlans = [
    {
      id: 'follower',
      faction: '跟單派',
      title: '分析師即時訊號訂閱',
      icon: Radio,
      price: '1,699',
      painPoint: '選股還在看K線，太慢了。',
      quickChips: ['即時通知', '進出場紀錄', '策略拆解'],
      features: [
        '即時訊號通知',
        '完整進出場紀錄',
        '策略邏輯拆解',
        '戰績定期回顧',
      ],
      cta: '/experts?role=advisor',
      ctaText: '選跟單派',
      color: 'advisor',
      ref: followerCardRef,
    },
    {
      id: 'cultivator',
      faction: '修煉派',
      title: '每週交易紀律與心得拆解',
      icon: BookOpen,
      price: '799',
      painPoint: '用每週復盤縮短學費，練成自己的出手心法。',
      quickChips: ['每週復盤', '決策依據', '框架整理'],
      features: [
        '上週決策復盤',
        '出手依據拆解',
        '避雷交易紀律',
        '框架筆記整理',
      ],
      cta: '/experts?role=mentor',
      ctaText: '選修煉派',
      color: 'mentor',
      ref: cultivatorCardRef,
    },
  ];

  return (
    <PortalLayout>
      <div className="container py-8 md:py-12">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-4">方案與價格</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
            先選門派，再決定要不要加購健檢。
          </p>
        </div>

        {/* Quick Comparison - Two Decision Pills */}
        <div className="max-w-3xl mx-auto mb-10">
          <div className="text-center mb-5">
            <h2 className="text-base font-semibold mb-1">快速對照</h2>
            <p className="text-sm text-muted-foreground">只選一個：省時間／練方法</p>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            {/* Left Pill - 跟單派 */}
            <button
              onClick={() => handlePillClick('follower')}
              className="group relative bg-card border border-border rounded-xl p-5 text-left transition-all duration-200 hover:shadow-md hover:border-advisor/40"
              style={{ backgroundColor: 'hsl(20, 8%, 97%)' }}
            >
              <div className="text-xs text-muted-foreground font-medium mb-2">
                ⚡ 跟單派
              </div>
              <p className="text-base md:text-lg font-bold text-foreground leading-snug">
                我要省時間，照訊號出手
              </p>
            </button>

            {/* Right Pill - 修煉派 */}
            <button
              onClick={() => handlePillClick('cultivator')}
              className="group relative bg-card border border-border rounded-xl p-5 text-left transition-all duration-200 hover:shadow-md hover:border-mentor/40"
              style={{ backgroundColor: 'hsl(210, 8%, 97%)' }}
            >
              <div className="text-xs text-muted-foreground font-medium mb-2">
                📘 修煉派
              </div>
              <p className="text-base md:text-lg font-bold text-foreground leading-snug">
                我要練方法，用復盤學決策
              </p>
            </button>
          </div>
        </div>

        {/* Hint before plan cards */}
        <div className="text-center mb-6">
          <p className="text-sm text-muted-foreground">你想要的是「省時間」還是「練方法」？</p>
        </div>

        {/* Main Plans */}
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto mb-12">
          {mainPlans.map((plan) => {
            const isAdvisor = plan.color === 'advisor';
            const isExpanded = expandedCard === plan.id;
            const isOtherExpanded = expandedCard && expandedCard !== plan.id;
            
            return (
              <Card 
                key={plan.id}
                ref={plan.ref}
                id={`${plan.id}-card`}
                className={cn(
                  "relative overflow-hidden border-2 transition-all duration-500",
                  isAdvisor ? "border-advisor/30" : "border-mentor/30",
                  isOtherExpanded && "opacity-90"
                )}
              >
                {/* Background Image - adjusted positioning */}
                {isAdvisor && <div className="absolute inset-0 bg-[#1a0a0a]" />}
                <div 
                  className="absolute inset-0 bg-cover bg-no-repeat transition-all duration-500"
                  style={{ 
                    backgroundImage: `url(${isAdvisor ? cardKungfuSpeed : cardKungfuBones})`,
                    backgroundPosition: isAdvisor ? 'right -100px center' : 'left -120px center',
                    filter: 'brightness(0.85) contrast(1.05)',
                    opacity: 0.7
                  }}
                />
                {/* Stronger overlay for better text readability */}
                <div className={cn(
                  "absolute inset-0",
                  isAdvisor 
                    ? "bg-gradient-to-r from-black/95 via-black/85 to-black/50" 
                    : "bg-gradient-to-l from-black/95 via-black/85 to-black/50"
                )} />
                {/* Top color bar */}
                <div className={cn(
                  "absolute top-0 left-0 right-0 h-1.5 z-10",
                  isAdvisor ? "gradient-advisor" : "gradient-mentor"
                )} />
                
                <CardHeader className="pb-3 relative z-10">
                  <div className={cn(
                    "h-12 w-12 rounded-xl flex items-center justify-center mb-3 backdrop-blur-sm",
                    isAdvisor ? "bg-advisor/20 ring-1 ring-advisor/30" : "bg-mentor/20 ring-1 ring-mentor/30"
                  )}>
                    <plan.icon className={cn(
                      "h-6 w-6",
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
                  {/* Pain Point Sentence */}
                  <p className={cn(
                    "text-sm font-medium mt-2 italic",
                    isAdvisor ? "text-advisor" : "text-mentor"
                  )}>
                    「{plan.painPoint}」
                  </p>
                </CardHeader>
                
                <CardContent className="space-y-4 relative z-10">
                  {/* Quick Chips - 3 items */}
                  <div className="flex flex-wrap gap-2">
                    {plan.quickChips.map((chip, idx) => (
                      <span 
                        key={idx}
                        className={cn(
                          "text-xs px-3 py-1.5 rounded-full",
                          isAdvisor 
                            ? "bg-advisor/20 text-white border border-advisor/30" 
                            : "bg-mentor/20 text-white border border-mentor/30"
                        )}
                      >
                        {chip}
                      </span>
                    ))}
                  </div>

                  {/* Price + CTA - Most prominent */}
                  <div className="pt-4 pb-2 border-t border-white/20">
                    <div className="flex items-baseline gap-1 mb-4">
                      <span className="text-sm text-white/60">NT$</span>
                      <span className="text-3xl font-bold text-white">{plan.price}</span>
                      <span className="text-white/60">／月</span>
                    </div>
                    
                    {/* CTA Buttons */}
                    <div className="space-y-3">
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
                      <Button 
                        variant="ghost" 
                        className="w-full text-white/50 hover:text-white/80 hover:bg-white/5"
                        size="sm"
                        onClick={() => openExample(plan.id as 'follower' | 'cultivator')}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        先看範例
                      </Button>
                    </div>
                  </div>

                  {/* Accordion for full details */}
                  <Accordion 
                    type="single" 
                    collapsible 
                    value={isExpanded ? 'details' : ''}
                    onValueChange={(val) => setExpandedCard(val ? plan.id : null)}
                    className="border-t border-white/10 pt-2"
                  >
                    <AccordionItem value="details" className="border-none">
                      <AccordionTrigger className="text-sm text-white/60 hover:text-white/80 py-2 hover:no-underline">
                        看完整內容
                      </AccordionTrigger>
                      <AccordionContent className="pt-2">
                        <div className="text-sm text-white/60 mb-2">
                          你會拿到：
                        </div>
                        <ul className="space-y-2">
                          {plan.features.map((feature, idx) => (
                            <li key={idx} className="flex items-center gap-2.5">
                              <CheckCircle className={cn(
                                "h-4 w-4 flex-shrink-0",
                                isAdvisor ? "text-advisor" : "text-mentor"
                              )} />
                              <span className="text-white text-sm">{feature}</span>
                            </li>
                          ))}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Example Modal */}
        <Dialog open={exampleModalOpen} onOpenChange={setExampleModalOpen}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {activeExample === 'follower' ? (
                  <>
                    <Radio className="h-5 w-5 text-advisor" />
                    <span>跟單派範例</span>
                  </>
                ) : (
                  <>
                    <BookOpen className="h-5 w-5 text-mentor" />
                    <span>修煉派範例</span>
                  </>
                )}
              </DialogTitle>
            </DialogHeader>
            
            {activeExample === 'follower' ? (
              <div className="space-y-6 mt-4">
                {/* Signal Notification Example */}
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">訊號通知樣式</h4>
                  <Card className="bg-advisor/5 border-advisor/20">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="h-10 w-10 rounded-full bg-advisor/20 flex items-center justify-center flex-shrink-0">
                          <Zap className="h-5 w-5 text-advisor" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="advisor" className="text-xs">買進訊號</Badge>
                            <span className="text-xs text-muted-foreground">09:32</span>
                          </div>
                          <p className="font-medium">XXXX 電子</p>
                          <p className="text-sm text-muted-foreground mt-1">
                            突破前高壓力，量能放大，短線可留意。
                          </p>
                          <div className="flex items-center gap-4 mt-2 text-sm">
                            <span>建議價位：<span className="text-advisor font-medium">$XX.X</span></span>
                            <span>目標：<span className="text-green-500">+8%</span></span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Trade Record Example */}
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">進出場紀錄樣式</h4>
                  <Card className="bg-muted/30">
                    <CardContent className="p-4">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between pb-2 border-b border-border">
                          <span className="font-medium">XXXX 金融</span>
                          <Badge variant="outline" className="text-green-500 border-green-500/30">+12.5%</Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">買進</span>
                            <p className="font-medium">$XX.X @ 01/15</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">賣出</span>
                            <p className="font-medium">$XX.X @ 01/22</p>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          策略邏輯：均線多頭排列，突破整理平台後順勢進場。
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : (
              <div className="space-y-6 mt-4">
                {/* Weekly Review Example */}
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">週報拆解樣式</h4>
                  <Card className="bg-mentor/5 border-mentor/20">
                    <CardContent className="p-4">
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <Badge variant="mentor" className="text-xs">本週復盤</Badge>
                          <span className="text-xs text-muted-foreground">Week 03</span>
                        </div>
                        <h4 className="font-medium">為什麼這週我選擇觀望？</h4>
                        <div className="text-sm text-muted-foreground space-y-2">
                          <p>• 大盤量縮，個股漲跌比偏空</p>
                          <p>• 手上持股已達部位上限</p>
                          <p>• 沒有符合進場條件的標的出現</p>
                        </div>
                        <div className="pt-2 border-t border-border">
                          <p className="text-sm">
                            <span className="text-mentor font-medium">學習重點：</span>
                            <span className="text-muted-foreground"> 不出手也是一種決策，等待是紀律的一部分。</span>
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Decision Process Example */}
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">決策流程筆記樣式</h4>
                  <Card className="bg-muted/30">
                    <CardContent className="p-4">
                      <div className="space-y-3">
                        <h4 className="font-medium">進場前我會問自己的 3 個問題</h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex items-start gap-2">
                            <span className="h-5 w-5 rounded-full bg-mentor/20 text-mentor flex items-center justify-center text-xs font-bold flex-shrink-0">1</span>
                            <p>這檔的主力籌碼結構如何？是吸籌還是出貨？</p>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="h-5 w-5 rounded-full bg-mentor/20 text-mentor flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>
                            <p>現在進場的風險報酬比是否合理？</p>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="h-5 w-5 rounded-full bg-mentor/20 text-mentor flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>
                            <p>如果錯了，我的停損點在哪？</p>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground pt-2 border-t border-border">
                          這個框架幫助我避開衝動交易，每次都能冷靜評估。
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

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
                q: '健檢交付形式是什麼？多久拿到？',
                a: '健檢報告會以 PDF 形式透過 Line 或 Email 寄送，通常在提交資料後 3 個工作天內完成。'
              },
              {
                q: '健檢可以買幾次？',
                a: '只要你的跟單派訂閱還在有效期間內，就可以隨時加購。每次加購都是獨立的單次服務，沒有次數限制。'
              },
              {
                q: '我該選哪一派？',
                a: '如果你時間有限、想省去選股研究的功夫，選跟單派。如果你想慢慢建立自己的交易系統、願意花時間學習，選修煉派。'
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
