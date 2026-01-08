import { Link } from 'react-router-dom';
import { UnifiedAppLayout } from '@/components/layouts/UnifiedAppLayout';
import { Badge } from '@/components/ui/badge';
import { SectionHeader } from '@/components/ui/section-header';
import { FeatureCard } from '@/components/ui/feature-card';
import { PerformanceMetrics } from '@/components/strategy/PerformanceMetrics';
import { 
  BarChart3, 
  ChevronRight,
  TrendingUp,
  Users,
  FileText
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { getUserSubscriptions } from '@/data/mockData';
import { getStrategySystemByExpertSlug } from '@/data/strategyMockData';
import { PlanType } from '@/types';

export default function Holdings() {
  const { user } = useAuth();
  const subscriptions = user ? getUserSubscriptions(user.id) : [];
  
  // Categorize subscriptions
  const advisorSubs = subscriptions.filter(s => 
    s.plan.planType === PlanType.ANALYST_SIGNAL_L1 || 
    s.plan.planType === PlanType.ANALYST_SIGNAL_DIAG_L2
  );
  
  const mentorSubs = subscriptions.filter(s => 
    s.plan.planType === PlanType.MENTOR_WEEKLY_JOURNAL
  );

  const hasAnySubscription = advisorSubs.length > 0 || mentorSubs.length > 0;

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

        {/* Advisor Subscriptions - 跟單派 */}
        {advisorSubs.length > 0 && (
          <section className="space-y-3">
            <SectionHeader
              number="01"
              tag="跟單派"
              title="即時訊號績效"
              theme="signals"
            />
            
            <div className="space-y-4">
              {advisorSubs.map((sub, index) => {
                const person = sub.person;
                const strategySystem = getStrategySystemByExpertSlug(person.slug);
                const summary = strategySystem?.performanceSummary;
                
                return (
                  <FeatureCard key={sub.id} theme="signals" className="p-4">
                    {/* Expert Header */}
                    <div className="flex items-center gap-3 mb-4">
                      <img 
                        src={person.avatarUrl} 
                        alt={person.name}
                        className="w-10 h-10 rounded-full object-cover ring-2 ring-signals-accent/30"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold truncate">{person.name}</span>
                          <Badge variant="outline" className="text-[10px] bg-signals-accent/10 text-signals-accent border-signals-accent/30">
                            跟單派
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {strategySystem?.name || person.bio}
                        </p>
                      </div>
                    </div>
                    
                    {/* Performance Metrics */}
                    {summary && (
                      <PerformanceMetrics summary={summary} className="mb-4" />
                    )}
                    
                    {/* CTA */}
                    <Link 
                      to={`/line/${person.slug}/performance`}
                      className="flex items-center justify-center gap-1 py-2.5 rounded-lg bg-signals-accent/10 text-signals-accent text-sm font-medium hover:bg-signals-accent/20 transition-colors"
                    >
                      查看完整績效 <ChevronRight className="h-4 w-4" />
                    </Link>
                  </FeatureCard>
                );
              })}
            </div>
          </section>
        )}

        {/* Mentor Subscriptions - 修煉派 */}
        {mentorSubs.length > 0 && (
          <section className="space-y-3">
            <SectionHeader
              number={advisorSubs.length > 0 ? "02" : "01"}
              tag="修煉派"
              title="教學週記績效"
              theme="learning"
            />
            
            <div className="space-y-4">
              {mentorSubs.map((sub, index) => {
                const person = sub.person;
                const strategySystem = getStrategySystemByExpertSlug(person.slug);
                const summary = strategySystem?.performanceSummary;
                
                return (
                  <FeatureCard key={sub.id} theme="learning" className="p-4">
                    {/* Expert Header */}
                    <div className="flex items-center gap-3 mb-4">
                      <img 
                        src={person.avatarUrl} 
                        alt={person.name}
                        className="w-10 h-10 rounded-full object-cover ring-2 ring-learning-accent/30"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold truncate">{person.name}</span>
                          <Badge variant="outline" className="text-[10px] bg-learning-accent/10 text-learning-accent border-learning-accent/30">
                            修煉派
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {strategySystem?.name || person.bio}
                        </p>
                      </div>
                    </div>
                    
                    {/* Performance Metrics */}
                    {summary && (
                      <PerformanceMetrics summary={summary} isDelayed className="mb-4" />
                    )}
                    
                    {/* T+7 Notice */}
                    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-learning-accent/5 border border-learning-accent/20 mb-4">
                      <FileText className="h-4 w-4 text-learning-accent flex-shrink-0" />
                      <p className="text-xs text-muted-foreground">
                        <span className="text-learning-accent font-medium">T+7 教學用資料</span> — 績效資料延遲7日發布
                      </p>
                    </div>
                    
                    {/* CTA */}
                    <Link 
                      to={`/line/${person.slug}/performance`}
                      className="flex items-center justify-center gap-1 py-2.5 rounded-lg bg-learning-accent/10 text-learning-accent text-sm font-medium hover:bg-learning-accent/20 transition-colors"
                    >
                      查看完整績效 <ChevronRight className="h-4 w-4" />
                    </Link>
                  </FeatureCard>
                );
              })}
            </div>
          </section>
        )}

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
