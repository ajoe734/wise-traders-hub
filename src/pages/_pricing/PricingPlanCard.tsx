import { RefObject } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ArrowRight, CheckCircle, Eye, LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import cardKungfuSpeed from '@/assets/card-kungfu-speed.webp';
import cardKungfuBones from '@/assets/card-kungfu-bones.webp';

export interface PricingPlan {
  id: string;
  faction: string;
  title: string;
  icon: LucideIcon;
  price: string;
  painPoint: string;
  quickChips: string[];
  features: string[];
  /** 額外的學習重點條列（例如修煉派「當週復盤／下週觀察框架」拆解） */
  mindsetPoints?: { title: string; points: string[] };
  cta: string;
  ctaText: string;
  color: string;
  ref: RefObject<HTMLDivElement>;
}

interface PricingPlanCardProps {
  plan: PricingPlan;
  isExpanded: boolean;
  isHighlighted?: boolean;
  onToggleExpansion: (cardId: string, isExpanded: boolean) => void;
  onOpenExample: (type: 'follower' | 'cultivator') => void;
  stopPropagationOnAccordion?: boolean;
}

export function PricingPlanCard({
  plan,
  isExpanded,
  isHighlighted = false,
  onToggleExpansion,
  onOpenExample,
  stopPropagationOnAccordion = false,
}: PricingPlanCardProps) {
  const isAdvisor = plan.color === 'advisor';

  return (
    <Card
      ref={plan.ref}
      id={`${plan.id}-card`}
      className={cn(
        'relative overflow-hidden border-2 transition-all duration-500',
        isAdvisor ? 'border-advisor/30' : 'border-mentor/30'
      )}
    >
      {isAdvisor && <div className="absolute inset-0 bg-[#1a0a0a]" />}
      <div
        className="absolute inset-0 bg-cover bg-no-repeat transition-all duration-500"
        style={{
          backgroundImage: `url(${isAdvisor ? cardKungfuSpeed : cardKungfuBones})`,
          backgroundPosition: isAdvisor ? 'right -100px center' : 'left -120px center',
          filter: 'brightness(0.85) contrast(1.05)',
          opacity: 0.7,
        }}
      />
      <div className={cn(
        'absolute inset-0 transition-opacity duration-300',
        isAdvisor
          ? 'bg-gradient-to-r from-black/95 via-black/85 to-black/50'
          : 'bg-gradient-to-l from-black/95 via-black/85 to-black/50',
        (isHighlighted || isExpanded) && 'opacity-40'
      )} />
      <div className={cn(
        'absolute top-0 left-0 right-0 h-1.5 z-10',
        isAdvisor ? 'gradient-advisor' : 'gradient-mentor'
      )} />

      <CardHeader className="pb-3 relative z-10">
        <div className={cn(
          'h-12 w-12 rounded-xl flex items-center justify-center mb-3 backdrop-blur-sm',
          isAdvisor ? 'bg-advisor/20 ring-1 ring-advisor/30' : 'bg-mentor/20 ring-1 ring-mentor/30'
        )}>
          <plan.icon className={cn('h-6 w-6', isAdvisor ? 'text-advisor' : 'text-mentor')} />
        </div>
        <Badge variant={isAdvisor ? 'advisor' : 'mentor'} className="w-fit mb-2 text-sm px-3 py-1">
          {plan.faction}
        </Badge>
        <CardTitle className="text-xl text-white">{plan.title}</CardTitle>
        <p
          className="text-sm font-semibold mt-2 italic drop-shadow-sm"
          style={{ color: 'hsl(30, 100%, 70%)', textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}
        >
          「{plan.painPoint}」
        </p>
      </CardHeader>

      <CardContent className="space-y-4 relative z-10">
        <div className="flex flex-wrap gap-2">
          {plan.quickChips.map((chip, idx) => (
            <span
              key={idx}
              className={cn(
                'text-xs px-3 py-1.5 rounded-full',
                isAdvisor
                  ? 'bg-advisor/20 text-white border border-advisor/30'
                  : 'bg-mentor/20 text-white border border-mentor/30'
              )}
            >
              {chip}
            </span>
          ))}
        </div>

        <div className="pt-4 pb-2 border-t border-white/20">
          <div className="flex items-baseline gap-1 mb-4">
            {plan.price !== '請洽詢' && <span className="text-sm text-white/60">NT$</span>}
            <span className="text-3xl font-bold text-white">{plan.price}</span>
            {plan.price !== '請洽詢' && <span className="text-white/60">／月</span>}
          </div>

          <div className="space-y-3">
            <Button variant={isAdvisor ? 'advisor' : 'mentor'} className="w-full" size="lg" asChild>
              <Link to={plan.cta}>
                {plan.ctaText}
                <ArrowRight className="h-4 w-4 ml-2" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              className="w-full text-white/50 hover:text-white/80 hover:bg-white/5"
              size="sm"
              onClick={(e) => {
                if (stopPropagationOnAccordion) e.stopPropagation();
                onOpenExample(plan.id as 'follower' | 'cultivator');
              }}
            >
              <Eye className="h-4 w-4 mr-2" />
              先看範例
            </Button>
          </div>
        </div>

        <Accordion
          type="single"
          collapsible
          value={isExpanded ? 'details' : ''}
          onValueChange={(val) => onToggleExpansion(plan.id, !!val)}
          className="border-t border-white/10 pt-2"
        >
          <AccordionItem value="details" className="border-none">
            <AccordionTrigger
              className="text-sm text-white/60 hover:text-white/80 py-2 hover:no-underline"
              onClick={stopPropagationOnAccordion ? (e) => e.stopPropagation() : undefined}
            >
              看完整內容
            </AccordionTrigger>
            <AccordionContent className="pt-2">
              <div className="text-sm text-white/60 mb-2">你會拿到：</div>
              <ul className="space-y-2">
                {plan.features.map((feature, idx) => (
                  <li key={idx} className="flex items-center gap-2.5">
                    <CheckCircle className={cn('h-4 w-4 flex-shrink-0', isAdvisor ? 'text-advisor' : 'text-mentor')} />
                    <span className="text-white text-sm">{feature}</span>
                  </li>
                ))}
              </ul>

              {plan.mindsetPoints && (
                <div
                  className="mt-4 pt-4 border-t border-white/10"
                  data-testid={`${plan.id}-mindset-points`}
                >
                  <div className="text-sm font-semibold text-white mb-2">
                    {plan.mindsetPoints.title}
                  </div>
                  <ul className="space-y-2">
                    {plan.mindsetPoints.points.map((pt, idx) => (
                      <li key={idx} className="flex items-start gap-2.5">
                        <span
                          className={cn(
                            'mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0',
                            isAdvisor ? 'bg-advisor' : 'bg-mentor'
                          )}
                        />
                        <span className="text-white/85 text-sm leading-relaxed">{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
