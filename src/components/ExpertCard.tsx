import { Link, useLocation } from 'react-router-dom';
import { PersonWithPlans, PlanType } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
import { cn } from '@/lib/utils';
import { Flame } from 'lucide-react';
import { avatarUrl } from '@/lib/imageTransform';
import { intentHandlers } from '@/lib/routePrefetch';
import { track } from '@/lib/analytics/events';
import { preserveUtm, utmCampaignOf } from '@/lib/preserveUtm';
import { cadenceLabel, FUNNEL_ONE_LINER } from '@/lib/complianceCopy';
interface ExpertCardProps {
  person: PersonWithPlans;
  /** 漏斗來源標記（例如 'experts_list'）。 */
  source?: string;
}

export function ExpertCard({ person, source }: ExpertCardProps) {
  const location = useLocation();
  const search = location.search;
  const utmCampaign = utmCampaignOf(search);
  const isAdv = person.role === 'advisor';
  const isFeatured = (person as any).isFeatured === true || person.name.includes('趙鵬博');

  const planLabels = person.plans.map(plan => {
    switch (plan.planType as PlanType) {
      case 'analyst_signal_l1': return '即時策略訂閱';
      case 'analyst_signal_diag_l2': return '策略＋持股健檢';
      case 'mentor_weekly_journal': return '修煉派週記教學';
      default: return plan.name;
    }
  });

  return (
    <Card 
      variant="interactive"
      className={cn(
        "overflow-hidden relative dark:border-white/10",
        isAdv ? "hover:border-advisor/30 dark:hover:border-advisor/50" : "hover:border-mentor/30 dark:hover:border-mentor/50",
        isFeatured && "ring-2 ring-amber-500/50 dark:ring-amber-400/60"
      )}
    >
      {isFeatured && (
        <div className="absolute top-3 right-3 z-10">
          <Badge className="bg-gradient-to-r from-amber-500 to-orange-500 text-white border-0 shadow-lg">
            <Flame className="h-3 w-3 mr-1" />熱門推薦
          </Badge>
        </div>
      )}
      <CardContent className="p-0">
        <div className="p-5">
          <div className="flex items-start gap-4">
            <img src={avatarUrl(person.avatarUrl, 160)} alt={person.name}
              loading="lazy" decoding="async"
              className={cn("h-20 w-20 rounded-full object-cover object-[center_15%] ring-2",
                isAdv ? "ring-advisor/20 dark:ring-advisor/40" : "ring-mentor/20 dark:ring-mentor/40")} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-lg">{person.name}</h3>
                <RoleBadge role={person.role} />
              </div>
              <p className="text-sm text-muted-foreground dark:text-white/60 mt-1 line-clamp-2">{person.bio}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
            {cadenceLabel(person.assetClass)}｜{FUNNEL_ONE_LINER}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-4">
            {person.styleTags.map(tag => <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>)}
            {person.markets.map(market => <Badge key={market} variant="outline" className="text-xs">{market}</Badge>)}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {planLabels.map((label, idx) => (
              <Badge key={idx} variant={isAdv ? 'advisor-light' : 'mentor-light'} className="text-xs">{label}</Badge>
            ))}
          </div>
        </div>
        <div className="border-t dark:border-white/10 bg-muted/30 dark:bg-white/[0.03] p-4 flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" asChild>
            <Link
              to={preserveUtm(`/expert/${person.slug}`, search)}
              {...intentHandlers('expert-profile')}
              onClick={() => track('expert_card_click', { expert_slug: person.slug, source, utm_campaign: utmCampaign })}
            >查看介紹</Link>
          </Button>
          <Button variant={isAdv ? 'advisor' : 'mentor'} size="sm" className="flex-1" asChild>
            <Link
              to={preserveUtm(`/expert/${person.slug}#plans`, search)}
              {...intentHandlers('expert-profile')}
              onClick={() => track('expert_card_click', { expert_slug: person.slug, source: source ? `${source}_plans` : 'plans', utm_campaign: utmCampaign })}
            >查看方案</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
