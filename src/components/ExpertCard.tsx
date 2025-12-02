import { Link } from 'react-router-dom';
import { PersonWithPlans, PersonRole, PlanType } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
import { cn } from '@/lib/utils';
import { Flame } from 'lucide-react';

interface ExpertCardProps {
  person: PersonWithPlans;
}

export function ExpertCard({ person }: ExpertCardProps) {
  const isAdvisor = person.role === PersonRole.ADVISOR;
  const isFeatured = person.name.includes('趙彭博');

  const planLabels = person.plans.map(plan => {
    switch (plan.planType) {
      case PlanType.ANALYST_SIGNAL_L1:
        return '即時策略訂閱';
      case PlanType.ANALYST_SIGNAL_DIAG_L2:
        return '策略＋持股健檢';
      case PlanType.MENTOR_WEEKLY_JOURNAL:
        return '實戰週記教學（T+7）';
      default:
        return plan.name;
    }
  });

  return (
    <Card 
      variant="interactive"
      className={cn(
        "overflow-hidden relative",
        isAdvisor ? "hover:border-advisor/30" : "hover:border-mentor/30",
        isFeatured && "ring-2 ring-amber-500/50"
      )}
    >
      {/* Featured Badge */}
      {isFeatured && (
        <div className="absolute top-3 right-3 z-10">
          <Badge className="bg-gradient-to-r from-amber-500 to-orange-500 text-white border-0 shadow-lg">
            <Flame className="h-3 w-3 mr-1" />
            熱門推薦
          </Badge>
        </div>
      )}
      <CardContent className="p-0">
        <div className="p-5">
          {/* Header */}
          <div className="flex items-start gap-4">
            <img
              src={person.avatarUrl || '/placeholder.svg'}
              alt={person.name}
              className={cn(
                "h-14 w-14 rounded-full object-cover ring-2",
                isAdvisor ? "ring-advisor/20" : "ring-mentor/20"
              )}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-lg">{person.name}</h3>
                <RoleBadge role={person.role} />
              </div>
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                {person.bio}
              </p>
            </div>
          </div>

          {/* Style Tags */}
          <div className="flex flex-wrap gap-1.5 mt-4">
            {person.styleTags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            {person.markets.map((market) => (
              <Badge key={market} variant="outline" className="text-xs">
                {market}
              </Badge>
            ))}
          </div>

          {/* Plan Chips */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {planLabels.map((label, idx) => (
              <Badge 
                key={idx} 
                variant={isAdvisor ? 'advisor-light' : 'mentor-light'}
                className="text-xs"
              >
                {label}
              </Badge>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="border-t bg-muted/30 p-4 flex gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            className="flex-1"
            asChild
          >
            <Link to={`/expert/${person.slug}`}>查看介紹</Link>
          </Button>
          <Button 
            variant={isAdvisor ? 'advisor' : 'mentor'}
            size="sm" 
            className="flex-1"
            asChild
          >
            <Link to={`/expert/${person.slug}#plans`}>查看方案</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}