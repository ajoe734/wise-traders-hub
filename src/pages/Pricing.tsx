import { useState, useRef, useEffect } from 'react';
import { SEO } from '@/components/SEO';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Radio, BookOpen } from 'lucide-react';
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

  const { data: bundle } = usePricingBundle();

  const followerCardRef = useRef<HTMLDivElement>(null);
  const cultivatorCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => { trackEvent('pricing_view'); }, []);


  const openExample = (type: 'follower' | 'cultivator') => {
    setActiveExample(type);
    setExampleModalOpen(true);
  };

  const handlePillClick = (cardType: 'follower' | 'cultivator') => {
    track('checkup_upgrade_click', { from: `pricing_pill_${cardType}` });
    const targetRef = cardType === 'follower' ? followerCardRef : cultivatorCardRef;
    setExpandedCards(prev => new Set(prev).add(cardType));
    setTimeout(() => {
      targetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    setHighlightedCard(prev => prev === cardType ? null : cardType);
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
      title: '當週操作復盤＋下週觀察框架',
      icon: BookOpen,
      price: bundle?.minMentorPrice ? bundle.minMentorPrice.toLocaleString() : '請洽詢',
      painPoint: '週末才有空，想把整週的操作看懂再做功課',
      quickChips: ['當週復盤', '判斷依據', '觀察框架'],
      features: ['當週操作復盤', '判斷依據拆解', '風險與部位條件', '下週研究清單與觀察條件'],
      mindsetPoints: {
        title: '每週你會練到：',
        points: [
          '看老師公開的當週操作復盤，理解每一筆為什麼進、為什麼出',
          '拆解多空判斷與資金配置的依據，累積自己的判斷框架',
          '對照下週研究清單與觀察條件，練習自己列出觀察與風險情境',
          '每週累積筆記，逐步養成獨立判斷的交易紀律',
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

        {/* Main Plans — 單欄 document flow（<768px），桌機兩欄 */}
        <div
          className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto mb-12"
          data-testid="pricing-plan-grid"
        >
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
