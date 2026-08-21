import { useState, useRef, useEffect } from 'react';
import { SEO } from '@/components/SEO';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Radio, BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePricingBundle } from '@/hooks/usePricingBundle';
import { PricingPlanCard, type PricingPlan } from './_pricing/PricingPlanCard';
import { PricingExampleModal } from './_pricing/PricingExampleModal';
import { PricingFaq } from './_pricing/PricingFaq';
import { CheckupPlansSection } from './_pricing/CheckupPlansSection';
import { PricingComparisonSection } from './_pricing/PricingComparisonSection';
import { trackEvent } from '@/lib/trafficTracker';
import { track } from '@/lib/analytics/events';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { EvidenceCard } from '@/components/evidence/EvidenceCard';
import {
  DELIVERY_STRUCTURE,
  PUBLISH_MECHANISM_TITLE,
  PUBLISH_MECHANISM_LINES,
  FUNNEL_ONE_LINER,
} from '@/lib/complianceCopy';


const Pricing = () => {
  const [exampleModalOpen, setExampleModalOpen] = useState(false);
  const [activeExample, setActiveExample] = useState<'follower' | 'cultivator' | null>(null);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [highlightedCard, setHighlightedCard] = useState<'follower' | 'cultivator' | null>(null);
  const [mobileSelectedIndex, setMobileSelectedIndex] = useState(0);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [showHint, setShowHint] = useState(true);

  const { data: bundle } = usePricingBundle();

  const isMobile = useIsMobile();
  const followerCardRef = useRef<HTMLDivElement>(null);
  const cultivatorCardRef = useRef<HTMLDivElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);

  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  useEffect(() => {
    if (hasInteracted) setShowHint(false);
  }, [hasInteracted]);

  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 4000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => { trackEvent('pricing_view'); }, []);


  const openExample = (type: 'follower' | 'cultivator') => {
    setActiveExample(type);
    setExampleModalOpen(true);
  };

  const handlePillClick = (cardType: 'follower' | 'cultivator') => {
    track('checkup_upgrade_click', { from: `pricing_pill_${cardType}` });
    const targetIndex = cardType === 'follower' ? 0 : 1;

    if (isMobile) {
      setMobileSelectedIndex(targetIndex);
      setHasInteracted(true);
      setTimeout(() => {
        carouselRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    } else {
      const targetRef = cardType === 'follower' ? followerCardRef : cultivatorCardRef;
      const cardId = cardType === 'follower' ? 'follower' : 'cultivator';
      setExpandedCards(prev => new Set(prev).add(cardId));
      setTimeout(() => {
        targetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }

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
      if (isExpanded) next.add(cardId);
      else next.delete(cardId);
      return next;
    });
  };

  const mainPlans: PricingPlan[] = [
    {
      id: 'follower',
      faction: '跟單派',
      title: '分析師下單即時line通知',
      icon: Radio,
      price: bundle?.minAdvisorPrice ? bundle.minAdvisorPrice.toLocaleString() : '請洽詢',
      painPoint: '選股還在看K線，太慢了。',
      quickChips: ['即時通知', '進出場紀錄', '策略拆解'],
      features: ['即時訊號通知', '完整進出場紀錄', '策略邏輯拆解', '戰績定期回顧'],
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
      price: bundle?.minMentorPrice ? bundle.minMentorPrice.toLocaleString() : '請洽詢',
      painPoint: '週末才有空，利用老師的心法決定下週出手',
      quickChips: ['每週復盤', '決策依據', '框架整理'],
      features: ['上週決策復盤', '出手依據拆解', '避雷交易紀律', '框架筆記整理'],
      mindsetPoints: {
        title: '「心法決定下週出手」你會學到：',
        points: [
          '週末看老師公開的上週交易紀錄與復盤，理解每一筆為什麼進、為什麼出',
          '拆解老師本週的多空判斷與資金配置心法，作為自己下週出手的依據',
          '對照自己的持倉，練習用同一套框架決定加碼、減碼或觀望',
          '每週累積筆記，逐步養成不靠訊號也能獨立判斷的交易紀律',
        ],
      },
      cta: '/experts?role=mentor',
      ctaText: '選修煉派',
      color: 'mentor',
      ref: cultivatorCardRef,
    },
  ];

  return (
    <PortalLayout>
      <SEO
        title="訂閱方案與價格 | legendflow"
        description="透明價格與多種方案：投顧策略訊號、實戰導師週記、AI 持倉診斷。月繳/年繳彈性選擇，立即比較最適合你的訂閱方案。"
        path="/pricing"
      />
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
            <button
              onClick={() => handlePillClick('follower')}
              className="group relative bg-card dark:bg-white/5 border border-border dark:border-white/10 rounded-xl p-5 text-left transition-all duration-200 hover:shadow-md hover:border-advisor/40"
            >
              <div className="text-xs text-muted-foreground dark:text-white/60 font-medium mb-2">
                ⚡ 跟單派
              </div>
              <p className="text-base md:text-lg font-bold text-foreground leading-snug">
                我要省時間，照訊號出手
              </p>
            </button>

            <button
              onClick={() => handlePillClick('cultivator')}
              className="group relative bg-card dark:bg-white/5 border border-border dark:border-white/10 rounded-xl p-5 text-left transition-all duration-200 hover:shadow-md hover:border-mentor/40"
            >
              <div className="text-xs text-muted-foreground dark:text-white/60 font-medium mb-2">
                📘 修煉派
              </div>
              <p className="text-base md:text-lg font-bold text-foreground leading-snug">
                我要練方法，用復盤學決策
              </p>
            </button>
          </div>
        </div>

        <div className="text-center mb-6">
          <p className="text-sm text-muted-foreground">你想要的是「省時間」還是「練方法」？</p>
        </div>

        {/* Main Plans */}
        {isMobile ? (
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
                      pointerEvents: 'auto',
                    }}
                  >
                    <PricingPlanCard
                      plan={plan}
                      isExpanded={expandedCards.has(plan.id)}
                      onToggleExpansion={toggleCardExpansion}
                      onOpenExample={openExample}
                      stopPropagationOnAccordion
                    />
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => { setMobileSelectedIndex(0); setHasInteracted(true); }}
              className={cn(
                'absolute left-0 top-1/2 -translate-y-1/2 z-30 p-2 rounded-full bg-black/40 backdrop-blur-sm transition-opacity',
                mobileSelectedIndex === 0 ? 'opacity-30' : 'opacity-100'
              )}
              disabled={mobileSelectedIndex === 0}
            >
              <ChevronLeft className="h-5 w-5 text-white" />
            </button>
            <button
              onClick={() => { setMobileSelectedIndex(1); setHasInteracted(true); }}
              className={cn(
                'absolute right-0 top-1/2 -translate-y-1/2 z-30 p-2 rounded-full bg-black/40 backdrop-blur-sm transition-opacity',
                mobileSelectedIndex === 1 ? 'opacity-30' : 'opacity-100'
              )}
              disabled={mobileSelectedIndex === 1}
            >
              <ChevronRight className="h-5 w-5 text-white" />
            </button>

            <div className="flex justify-center gap-2 mt-4">
              {mainPlans.map((_, index) => (
                <button
                  key={index}
                  onClick={() => { setMobileSelectedIndex(index); setHasInteracted(true); }}
                  className={cn(
                    'h-2 rounded-full transition-all duration-300',
                    index === mobileSelectedIndex ? 'w-6 bg-primary' : 'w-2 bg-muted-foreground/30'
                  )}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto mb-12">
            {mainPlans.map((plan) => (
              <PricingPlanCard
                key={plan.id}
                plan={plan}
                isExpanded={expandedCards.has(plan.id)}
                isHighlighted={highlightedCard === plan.id}
                onToggleExpansion={toggleCardExpansion}
                onOpenExample={openExample}
              />
            ))}
          </div>
        )}

        <PricingExampleModal
          open={exampleModalOpen}
          onOpenChange={setExampleModalOpen}
          activeExample={activeExample}
        />

        {/* ── 每週交付結構 + 公開機制（中性敘述） ── */}
        <section className="py-10" aria-label={PUBLISH_MECHANISM_TITLE}>
          <h2 className="text-h3 mb-2">訂閱之後，每週拿到什麼</h2>
          <p className="text-sm text-muted-foreground mb-5 leading-relaxed">{FUNNEL_ONE_LINER}</p>
          <div className="grid gap-4 md:grid-cols-3">
            {DELIVERY_STRUCTURE.map((d) => (
              <EvidenceCard key={d.key} title={d.title} description={d.desc} />
            ))}
          </div>
          <details
            className="mt-5 rounded-lg border p-4"
            onToggle={(e) => {
              if ((e.currentTarget as HTMLDetailsElement).open) {
                track('pricing_mechanism_expand', { section: 'publish_mechanism' });
              }
            }}
          >
            <summary className="cursor-pointer text-sm font-medium">{PUBLISH_MECHANISM_TITLE}</summary>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              {PUBLISH_MECHANISM_LINES.map((line) => <p key={line}>{line}</p>)}
            </div>
          </details>
          <div className="mt-5">
            <Button size="lg" asChild><Link to="/experts">看看有哪些老師</Link></Button>
          </div>
        </section>

        <PricingComparisonSection />

        <CheckupPlansSection />

        <PricingFaq />
      </div>
    </PortalLayout>
  );
};

export default Pricing;
