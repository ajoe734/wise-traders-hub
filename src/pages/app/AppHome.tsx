import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
import { useAuth } from '@/contexts/AuthContext';
import { getUserSubscriptions } from '@/data/mockData';
import { PersonRole, PlanType } from '@/types';
import { Radio, BookOpen, ChevronRight, ExternalLink } from 'lucide-react';

const AppHome = () => {
  const { user } = useAuth();
  const subscriptions = user ? getUserSubscriptions(user.id) : [];
  
  const advisorSubs = subscriptions.filter(s => 
    s.plan.planType === PlanType.ANALYST_SIGNAL_L1 || 
    s.plan.planType === PlanType.ANALYST_SIGNAL_DIAG_L2
  );
  const mentorSubs = subscriptions.filter(s => 
    s.plan.planType === PlanType.MENTOR_WEEKLY_JOURNAL
  );

  return (
    <AppLayout>
      <div className="p-4 space-y-6">
        {/* Greeting */}
        <div className="animate-fade-in">
          <h1 className="text-xl font-bold mb-1">
            嗨，{user?.name || '會員'}
          </h1>
          <p className="text-muted-foreground">這裡是你的訂閱服務。</p>
        </div>

        {/* Advisor Subscriptions */}
        {advisorSubs.length > 0 && (
          <section className="space-y-3 animate-slide-up">
            <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
              <Radio className="h-4 w-4 text-advisor" />
              我的投顧分析師訂閱
            </h2>
            {advisorSubs.map(sub => (
              <Card key={sub.id} className="border-advisor/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <img src={sub.person.avatarUrl || '/placeholder.svg'} alt={sub.person.name} className="h-10 w-10 rounded-full object-cover" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{sub.person.name}</span>
                        <RoleBadge role={sub.person.role} size="sm" />
                      </div>
                      <Badge variant="advisor-light" className="text-[10px] mt-0.5">{sub.plan.name}</Badge>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">即時策略訊號＋每筆操作的教學解說</p>
                  <div className="flex gap-2">
                    <Button variant="advisor" size="sm" className="flex-1" asChild>
                      <Link to={`/line/${sub.person.slug}/signals`}>
                        看即時訊號
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </Link>
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1" asChild>
                      <Link to={`/line/${sub.person.slug}/teaching`}>策略教學</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>
        )}

        {/* Mentor Subscriptions */}
        {mentorSubs.length > 0 && (
          <section className="space-y-3 animate-slide-up" style={{ animationDelay: '0.1s' }}>
            <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-mentor" />
              我的實戰導師訂閱
            </h2>
            {mentorSubs.map(sub => (
              <Card key={sub.id} className="border-mentor/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <img src={sub.person.avatarUrl || '/placeholder.svg'} alt={sub.person.name} className="h-10 w-10 rounded-full object-cover" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{sub.person.name}</span>
                        <RoleBadge role={sub.person.role} size="sm" />
                      </div>
                      <Badge variant="mentor-light" className="text-[10px] mt-0.5">{sub.plan.name}</Badge>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">每週 T+7 實戰週記，回顧一週前操作</p>
                  <Button variant="mentor" size="sm" className="w-full" asChild>
                    <Link to={`/line/${sub.person.slug}/signals`}>
                      看週記教學
                      <ExternalLink className="h-3 w-3 ml-1" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </section>
        )}

        {/* Empty State */}
        {subscriptions.length === 0 && (
          <Card className="text-center py-8">
            <CardContent>
              <p className="text-muted-foreground mb-4">目前尚未訂閱任何服務</p>
              <Button asChild><Link to="/experts">探索專家</Link></Button>
            </CardContent>
          </Card>
        )}

        {/* Quick Links */}
        <div className="pt-4 space-y-2">
          <Link to="/account/subscriptions" className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
            <span className="text-sm">管理訂閱</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
          <Link to="/experts" className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
            <span className="text-sm">探索更多專家</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </div>
      </div>
    </AppLayout>
  );
};

export default AppHome;
