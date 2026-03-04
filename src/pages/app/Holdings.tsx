import { Link } from 'react-router-dom';
import { UnifiedAppLayout } from '@/components/layouts/UnifiedAppLayout';
import { Badge } from '@/components/ui/badge';
import { FeatureCard } from '@/components/ui/feature-card';
import { 
  BarChart3, 
  ChevronRight,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useMySubscriptions } from '@/hooks/useSubscriptions';

export default function Holdings() {
  const { data: subscriptions = [] } = useMySubscriptions();
  const hasAnySubscription = subscriptions.length > 0;

  return (
    <UnifiedAppLayout>
      <div className="p-4 space-y-6 max-w-lg mx-auto pb-24">
        {/* Header */}
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-[0_0_20px_-5px_hsl(var(--primary)/0.5)]">
                <BarChart3 className="h-6 w-6 text-white" />
              </div>
            </div>
            <div>
              <p className="text-xs text-primary font-semibold tracking-wider uppercase">Historical Performance</p>
              <h1 className="text-xl font-bold">專家戰績</h1>
            </div>
          </div>
        </div>

        {/* Empty State */}
        {!hasAnySubscription && (
          <FeatureCard className="p-8 text-center">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium mb-2">尚未訂閱任何專家</p>
            <p className="text-sm text-muted-foreground mb-4">
              訂閱專家後，可以在這裡查看他們的歷史績效表現
            </p>
            <Link 
              to="/experts"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              探索專家 <ChevronRight className="h-4 w-4" />
            </Link>
          </FeatureCard>
        )}

        {/* Subscriptions list */}
        {subscriptions.map((sub: any) => (
          <FeatureCard key={sub.id} className="p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold truncate">方案 #{sub.plan_id?.slice(0, 8)}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {sub.status}
                  </Badge>
                </div>
              </div>
            </div>
          </FeatureCard>
        ))}

        {/* Upsell CTA */}
        {hasAnySubscription && (
          <FeatureCard className="p-5 text-center">
            <TrendingUp className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="font-medium mb-1">想看更多厲害的專家？</p>
            <p className="text-sm text-muted-foreground mb-4">
              我們有多位專業分析師和導師等你加入
            </p>
            <Link 
              to="/experts"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              探索更多專家 <ChevronRight className="h-4 w-4" />
            </Link>
          </FeatureCard>
        )}
      </div>
    </UnifiedAppLayout>
  );
}
