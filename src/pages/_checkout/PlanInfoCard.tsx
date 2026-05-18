import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { avatarUrl } from '@/lib/imageTransform';

interface Plan {
  name: string;
  plan_type: string;
  price_monthly: number;
  price_yearly: number | null;
  description: string | null;
  features: any;
}

interface Expert {
  name: string;
  avatar_url: string | null;
}

interface PlanInfoCardProps {
  plan: Plan;
  expert: Expert;
  isAdvisor: boolean;
  billingCycle: 'monthly' | 'yearly';
  setBillingCycle: (c: 'monthly' | 'yearly') => void;
  getPlanFeatures: (planType: string) => string[];
  formatPrice: (p: number) => string;
}

export function PlanInfoCard({
  plan,
  expert,
  isAdvisor,
  billingCycle,
  setBillingCycle,
  getPlanFeatures,
  formatPrice,
}: PlanInfoCardProps) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">訂閱內容</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <img
              src={avatarUrl(expert.avatar_url, 112)}
              alt={expert.name}
              loading="lazy"
              decoding="async"
              className="shrink-0 h-14 w-14 rounded-xl object-cover object-[center_15%]"
            />
            <div>
              <span className="font-semibold">{expert.name}</span>
              <p className="text-sm text-muted-foreground">{plan.name}</p>
            </div>
          </div>

          <div className={cn(
            "p-4 rounded-lg border-2",
            isAdvisor ? "border-advisor/20 bg-advisor-light/30" : "border-mentor/20 bg-mentor-light/30"
          )}>
            <h3 className="font-semibold mb-2">{plan.name}</h3>
            {plan.description && (
              <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>
            )}
            <ul className="space-y-2">
              {(Array.isArray(plan.features) && (plan.features as any[]).filter((f: any) => typeof f === 'string' && f.trim()).length > 0
                ? (plan.features as string[]).filter((f) => typeof f === 'string' && f.trim())
                : getPlanFeatures(plan.plan_type)
              ).map((feature, idx) => (
                <li key={idx} className="flex items-center gap-2 text-sm">
                  <CheckCircle className={cn("h-4 w-4", isAdvisor ? "text-advisor" : "text-mentor")} />
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">選擇付款週期</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={cn(
                "p-4 rounded-lg border-2 text-left transition-colors",
                billingCycle === 'monthly'
                  ? isAdvisor ? "border-primary bg-primary/5" : "border-mentor bg-mentor-light/30"
                  : isAdvisor ? "border-border hover:border-primary/50" : "border-border hover:border-mentor/50"
              )}
            >
              <p className="font-semibold">月繳</p>
              <p className="text-2xl font-bold mt-1">NT$ {formatPrice(plan.price_monthly)}</p>
              <p className="text-sm text-muted-foreground">每月</p>
            </button>
            <button
              disabled
              className={cn(
                "p-4 rounded-lg border-2 text-left transition-colors relative",
                "border-border opacity-50 cursor-not-allowed"
              )}
            >
              {plan.price_yearly && (
                <Badge variant="secondary" className="absolute -top-2 -right-2 rotate-12">
                  省 {Math.round((1 - plan.price_yearly / (plan.price_monthly * 12)) * 100)}%
                </Badge>
              )}
              <p className="font-semibold">年繳</p>
              <p className="text-2xl font-bold mt-1">
                NT$ {formatPrice(plan.price_yearly || plan.price_monthly * 12)}
              </p>
              <p className="text-sm text-muted-foreground">尚未開放</p>
            </button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
