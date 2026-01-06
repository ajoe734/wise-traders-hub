import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { CheckCircle, ArrowRight, Radio, BookOpen, Stethoscope, Plus, AlertCircle, Zap, Clock, Target, Lightbulb, Eye, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import cardKungfuSpeed from '@/assets/card-kungfu-speed.png';
import cardKungfuBones from '@/assets/card-kungfu-bones.png';

const Pricing = () => {
  const [exampleModalOpen, setExampleModalOpen] = useState(false);
  const [activeExample, setActiveExample] = useState<'follower' | 'cultivator' | null>(null);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [highlightedCard, setHighlightedCard] = useState<'follower' | 'cultivator' | null>(null);
  const [mobileSelectedIndex, setMobileSelectedIndex] = useState(0);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [showHint, setShowHint] = useState(true);
  
  const isMobile = useIsMobile();
  const followerCardRef = useRef<HTMLDivElement>(null);
  const cultivatorCardRef = useRef<HTMLDivElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  
  // Touch handling for mobile carousel
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  // Stop hint animation after first interaction
  useEffect(() => {
    if (hasInteracted) {
      setShowHint(false);
    }
  }, [hasInteracted]);

  // Auto-hide hint after 4 seconds even without interaction
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowHint(false);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  const openExample = (type: 'follower' | 'cultivator') => {
    setActiveExample(type);
    setExampleModalOpen(true);
  };

  const handlePillClick = (cardType: 'follower' | 'cultivator') => {
    const targetIndex = cardType === 'follower' ? 0 : 1;
    
    // On mobile, switch carousel to the selected card
    if (isMobile) {
      setMobileSelectedIndex(targetIndex);
      setHasInteracted(true);
      // Scroll to carousel section
      setTimeout(() => {
        carouselRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    } else {
      const targetRef = cardType === 'follower' ? followerCardRef : cultivatorCardRef;
      const cardId = cardType === 'follower' ? 'follower' : 'cultivator';
      
      // Expand the clicked card (don't collapse the other)
      setExpandedCards(prev => new Set(prev).add(cardId));
      
      // Smooth scroll to card
      setTimeout(() => {
        targetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
    
    // Toggle highlight: clicking same pill again will turn off, clicking other pill switches
    setHighlightedCard(prev => prev === cardType ? null : cardType);
  };

  const handleSwipe = () => {
    const diff = touchStartX.current - touchEndX.current;
    const threshold = 50;
    
    if (Math.abs(diff) > threshold) {
      setHasInteracted(true);
      if (diff > 0 && mobileSelectedIndex < 1) {
        setMobileSelectedIndex(1);
      } else if (diff < 0 && mobileSelectedIndex > 0) {
        setMobileSelectedIndex(0);
      }
    }
  };

  const toggleCardExpansion = (cardId: string, isExpanded: boolean) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (isExpanded) {
        next.add(cardId);
      } else {
        next.delete(cardId);
      }
      return next;
    });
  };

  const mainPlans = [
    {
      id: 'follower',
      faction: '跟單派',
      title: '分析師下單即時line通知',
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
      title: '每週交易紀錄與心法公開',
      icon: BookOpen,
      price: '799',
      painPoint: '給我全部，練出自己的投資秘笈',
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
        {isMobile ? (
          /* Mobile Carousel - Showcase/Turntable Style */
          <div 
            ref={carouselRef}
            className="relative mb-12 px-4"
            style={{ perspective: '1000px' }}
          >
            <div 
              className="relative h-[520px]"
              onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
              onTouchEnd={(e) => { touchEndX.current = e.changedTouches[0].clientX; handleSwipe(); }}
            >
              {mainPlans.map((plan, index) => {
                const isActive = index === mobileSelectedIndex;
                const offset = index - mobileSelectedIndex;
                const isAdvisor = plan.color === 'advisor';
                const isExpanded = expandedCards.has(plan.id);
                
                // Hint animation class for swipe indication
                const hintClass = showHint && isActive ? 'animate-swipe-hint' : '';

                return (
                  <div
                    key={plan.id}
                    onClick={() => { setMobileSelectedIndex(index); setHasInteracted(true); }}
                    className={`absolute inset-x-0 mx-auto cursor-pointer transition-all duration-500 ease-out ${hintClass}`}
                    style={{
                      width: isActive ? '92%' : '75%',
                      transform: isActive 
                        ? 'translateX(0) translateZ(0) scale(1)' 
                        : `translateX(${offset * 60}%) translateZ(-80px) rotateY(${offset * -8}deg) scale(0.88)`,
                      opacity: isActive ? 1 : 0.5,
                      filter: isActive ? 'none' : 'brightness(0.7)',
                      zIndex: isActive ? 20 : 10,
                      pointerEvents: isActive ? 'auto' : 'auto',
                    }}
                  >
                    <Card 
                      ref={plan.ref}
                      id={`${plan.id}-card`}
                      className={cn(
                        "relative overflow-hidden border-2 transition-all duration-500",
                        isAdvisor ? "border-advisor/30" : "border-mentor/30"
                      )}
                    >
                      {/* Background Image */}
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
                      {/* Overlay for text readability */}
                      <div className={cn(
                        "absolute inset-0 transition-opacity duration-300",
                        isAdvisor 
                          ? "bg-gradient-to-r from-black/95 via-black/85 to-black/50" 
                          : "bg-gradient-to-l from-black/95 via-black/85 to-black/50",
                        isExpanded && "opacity-40"
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
                        <p 
                          className="text-sm font-semibold mt-2 italic drop-shadow-sm"
                          style={{ 
                            color: 'hsl(30, 100%, 70%)',
                            textShadow: '0 1px 3px rgba(0,0,0,0.5)'
                          }}
                        >
                          「{plan.painPoint}」
                        </p>
                      </CardHeader>
                      
                      <CardContent className="space-y-4 relative z-10">
                        {/* Quick Chips */}
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

                        {/* Price + CTA */}
                        <div className="pt-4 pb-2 border-t border-white/20">
                          <div className="flex items-baseline gap-1 mb-4">
                            <span className="text-sm text-white/60">NT$</span>
                            <span className="text-3xl font-bold text-white">{plan.price}</span>
                            <span className="text-white/60">／月</span>
                          </div>
                          
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
                              onClick={(e) => { e.stopPropagation(); openExample(plan.id as 'follower' | 'cultivator'); }}
                            >
                              <Eye className="h-4 w-4 mr-2" />
                              先看範例
                            </Button>
                          </div>
                        </div>

                        {/* Accordion for details */}
                        <Accordion 
                          type="single" 
                          collapsible 
                          value={isExpanded ? 'details' : ''}
                          onValueChange={(val) => toggleCardExpansion(plan.id, !!val)}
                          className="border-t border-white/10 pt-2"
                        >
                          <AccordionItem value="details" className="border-none">
                            <AccordionTrigger 
                              className="text-sm text-white/60 hover:text-white/80 py-2 hover:no-underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              看完整內容
                            </AccordionTrigger>
                            <AccordionContent className="pt-2">
                              <div className="text-sm text-white/60 mb-2">你會拿到：</div>
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
                  </div>
                );
              })}
            </div>

            {/* Navigation Arrows */}
            <button
              onClick={() => { setMobileSelectedIndex(0); setHasInteracted(true); }}
              className={cn(
                "absolute left-0 top-1/2 -translate-y-1/2 z-30 p-2 rounded-full bg-black/40 backdrop-blur-sm transition-opacity",
                mobileSelectedIndex === 0 ? "opacity-30" : "opacity-100"
              )}
              disabled={mobileSelectedIndex === 0}
            >
              <ChevronLeft className="h-5 w-5 text-white" />
            </button>
            <button
              onClick={() => { setMobileSelectedIndex(1); setHasInteracted(true); }}
              className={cn(
                "absolute right-0 top-1/2 -translate-y-1/2 z-30 p-2 rounded-full bg-black/40 backdrop-blur-sm transition-opacity",
                mobileSelectedIndex === 1 ? "opacity-30" : "opacity-100"
              )}
              disabled={mobileSelectedIndex === 1}
            >
              <ChevronRight className="h-5 w-5 text-white" />
            </button>

            {/* Dot indicators */}
            <div className="flex justify-center gap-2 mt-4">
              {mainPlans.map((_, index) => (
                <button
                  key={index}
                  onClick={() => { setMobileSelectedIndex(index); setHasInteracted(true); }}
                  className={cn(
                    "h-2 rounded-full transition-all duration-300",
                    index === mobileSelectedIndex 
                      ? "w-6 bg-primary" 
                      : "w-2 bg-muted-foreground/30"
                  )}
                />
              ))}
            </div>
          </div>
        ) : (
          /* Desktop Grid */
          <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto mb-12">
            {mainPlans.map((plan) => {
              const isAdvisor = plan.color === 'advisor';
              const isExpanded = expandedCards.has(plan.id);
              const isHighlighted = highlightedCard === plan.id;
              
              return (
                <Card 
                  key={plan.id}
                  ref={plan.ref}
                  id={`${plan.id}-card`}
                  className={cn(
                    "relative overflow-hidden border-2 transition-all duration-500",
                    isAdvisor ? "border-advisor/30" : "border-mentor/30"
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
                    "absolute inset-0 transition-opacity duration-300",
                    isAdvisor 
                      ? "bg-gradient-to-r from-black/95 via-black/85 to-black/50" 
                      : "bg-gradient-to-l from-black/95 via-black/85 to-black/50",
                    (isHighlighted || isExpanded) && "opacity-40"
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
                    <p 
                      className="text-sm font-semibold mt-2 italic drop-shadow-sm"
                      style={{ 
                        color: 'hsl(30, 100%, 70%)',
                        textShadow: '0 1px 3px rgba(0,0,0,0.5)'
                      }}
                    >
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
                      onValueChange={(val) => toggleCardExpansion(plan.id, !!val)}
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
        )}

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
                {/* Signal Notification Example - matching SignalCard style */}
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">訊號通知樣式</h4>
                  <Card className="border-border">
                    <CardContent className="p-4">
                      {/* Top Row: Time & Status */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          <span>01/15 09:05</span>
                        </div>
                        <Badge variant="success-light" className="text-[10px]">即時</Badge>
                      </div>

                      {/* Middle: Instrument & Action */}
                      <div className="flex items-center gap-3 mb-3">
                        <Badge variant="advisor" className="text-xs px-2 py-1">買進</Badge>
                        <span className="font-semibold text-lg">世芯-KY (3661.TW)</span>
                      </div>

                      {/* Price Hint */}
                      <div className="text-sm mb-3">
                        <span className="text-muted-foreground">建議價位：</span>
                        <span className="font-medium text-advisor">約 185-190</span>
                      </div>

                      {/* Summary */}
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                        4有指標全亮，開盤跳空突破前高，量能爆發，鎖定漲停潛力股。
                      </p>

                      {/* Risk Note Preview */}
                      <div className="bg-warning-light/50 rounded-lg p-2.5 text-xs text-warning mb-3">
                        💡 當沖操作，必須盤中嚴格監控，收盤前務必出場...
                      </div>

                      {/* CTA hint */}
                      <div className="flex items-center justify-end text-sm text-primary font-medium">
                        查看詳解與教學
                        <ArrowRight className="h-4 w-4 ml-1" />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Trade Record Example - position & risk notes */}
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">進出場紀錄 & 風控提示</h4>
                  <Card className="bg-muted/30">
                    <CardContent className="p-4 space-y-4">
                      {/* Risk Notes */}
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium mb-2">
                          <AlertCircle className="h-4 w-4 text-warning" />
                          <span>風險提示</span>
                        </div>
                        <ul className="text-sm text-muted-foreground space-y-1.5 pl-6 list-disc">
                          <li>當沖操作，必須盤中嚴格監控，收盤前務必出場</li>
                          <li>若跌破開盤價 3%，立即停損出場</li>
                          <li>今日若大盤急跌 &gt; 1.5%，優先減碼保護資金</li>
                        </ul>
                      </div>

                      {/* Position Notes */}
                      <div className="pt-3 border-t border-border">
                        <div className="flex items-center gap-2 text-sm font-medium mb-2">
                          <Target className="h-4 w-4 text-advisor" />
                          <span>倉位管理</span>
                        </div>
                        <ul className="text-sm text-muted-foreground space-y-1.5 pl-6 list-disc">
                          <li>本次進場為單筆資金的 100%（當沖不留倉）</li>
                          <li>第一目標價：漲停鎖定（+10%）</li>
                          <li>若無法攻上漲停，尾盤前 30 分鐘全數出場</li>
                        </ul>
                      </div>

                      {/* Learning Points */}
                      <div className="pt-3 border-t border-border">
                        <div className="flex items-center gap-2 text-sm font-medium mb-2">
                          <Lightbulb className="h-4 w-4 text-primary" />
                          <span>學習重點</span>
                        </div>
                        <ul className="text-sm text-muted-foreground space-y-1.5 pl-6 list-disc">
                          <li>這筆示範「4有同步」的選股邏輯，四個指標同時確認</li>
                          <li>開盤5分鐘是判斷當日強弱的關鍵觀察期</li>
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : (
              <div className="space-y-6 mt-4">
                {/* Weekly Journal Example - matching JournalCard style */}
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">週報教學樣式</h4>
                  <Card className="border-border hover:border-mentor/30">
                    <CardContent className="p-4">
                      {/* Week Range */}
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">01/06 ~ 01/12</span>
                        <Badge variant="mentor-light" className="text-[10px] ml-auto">
                          已解鎖（T+7 歷史）
                        </Badge>
                      </div>

                      {/* Title */}
                      <h3 className="font-semibold mb-2">本週我怎麼看待漲停追價</h3>

                      {/* Summary */}
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                        這週大盤震盪加劇，我選擇只操作有明確籌碼支撐的標的，避開追高風險...
                      </p>

                      {/* Stats */}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                        <span className="flex items-center gap-1">
                          <BookOpen className="h-3.5 w-3.5" />
                          本週 8 筆操作
                        </span>
                      </div>

                      {/* Learning Points Preview */}
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        <Badge variant="secondary" className="text-xs">量價配合判斷...</Badge>
                        <Badge variant="secondary" className="text-xs">停損紀律執行...</Badge>
                      </div>

                      {/* CTA hint */}
                      <div className="flex items-center justify-end text-sm text-mentor font-medium">
                        查看本週詳細教學
                        <ArrowRight className="h-4 w-4 ml-1" />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Trade List Example */}
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">本週交易紀錄樣式</h4>
                  <Card className="bg-muted/30">
                    <CardContent className="p-4">
                      <div className="space-y-3">
                        {/* Trade 1 */}
                        <div className="flex items-center justify-between py-2 border-b border-border">
                          <div className="flex items-center gap-3">
                            <Badge variant="mentor" className="text-[10px]">買進</Badge>
                            <span className="font-medium">台積電 (2330.TW)</span>
                          </div>
                          <Badge variant="outline" className="text-green-500 border-green-500/30 text-xs">漲停 +10%</Badge>
                        </div>
                        
                        {/* Trade 2 */}
                        <div className="flex items-center justify-between py-2 border-b border-border">
                          <div className="flex items-center gap-3">
                            <Badge variant="destructive" className="text-[10px]">停損</Badge>
                            <span className="font-medium">聯發科 (2454.TW)</span>
                          </div>
                          <Badge variant="outline" className="text-red-500 border-red-500/30 text-xs">-2.8%</Badge>
                        </div>

                        {/* Trade 3 */}
                        <div className="flex items-center justify-between py-2 border-b border-border">
                          <div className="flex items-center gap-3">
                            <Badge variant="mentor" className="text-[10px]">買進</Badge>
                            <span className="font-medium">世芯-KY (3661.TW)</span>
                          </div>
                          <Badge variant="outline" className="text-green-500 border-green-500/30 text-xs">+6.5%</Badge>
                        </div>

                        {/* Weekly Summary */}
                        <div className="pt-3 mt-2">
                          <div className="flex items-center gap-2 text-sm font-medium mb-2">
                            <Lightbulb className="h-4 w-4 text-mentor" />
                            <span>本週學習重點</span>
                          </div>
                          <ul className="text-sm text-muted-foreground space-y-1.5 pl-6 list-disc">
                            <li>量價配合是判斷進場時機的核心</li>
                            <li>停損紀律比獲利更重要</li>
                            <li>當沖必須在收盤前完全出場</li>
                          </ul>
                        </div>
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
