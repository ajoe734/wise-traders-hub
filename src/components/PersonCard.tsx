import { Link } from 'react-router-dom';
import { PersonWithPlans, PlanType } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
import { cn } from '@/lib/utils';

interface PersonCardProps {
  person: PersonWithPlans;
}

export function PersonCard({ person }: PersonCardProps) {
  const isAdv = person.role === 'advisor';

  const planLabels = person.plans.map(plan => {
    switch (plan.planType as PlanType) {
      case 'analyst_signal_l1': return '分析師即時策略訂閱';
      case 'analyst_signal_diag_l2': return '策略＋持股健檢';
      case 'mentor_weekly_journal': return '修煉派週記教學訂閱';
      default: return plan.name;
    }
  });

  return (
    <Card variant="interactive" className={cn("overflow-hidden", isAdv ? "hover:border-advisor/30" : "hover:border-mentor/30")}>
      <CardContent className="p-0">
        <div className="p-5">
          <div className="flex items-start gap-4">
            <img src={person.avatarUrl || '/placeholder.svg'} alt={person.name} className="h-14 w-14 rounded-full object-cover ring-2 ring-muted" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-lg">{person.name}</h3>
                <RoleBadge role={person.role} />
              </div>
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{person.bio}</p>
            </div>
          </div>
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
        <div className="border-t bg-muted/30 p-4 flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" asChild>
            <Link to={`/people/${person.slug}`}>查看介紹</Link>
          </Button>
          <Button variant={isAdv ? 'advisor' : 'mentor'} size="sm" className="flex-1" asChild>
            <Link to={`/people/${person.slug}#plans`}>查看方案</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
