import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { ModeSwitcher } from '@/pages/app/ModeSwitcher';
import { SignalsDashboard } from '@/pages/app/SignalsDashboard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { getUserSubscriptions } from '@/data/mockData';
import { PlanType } from '@/types';

const AppHome = () => {
  const { user } = useAuth();
  const subscriptions = user ? getUserSubscriptions(user.id) : [];
  
  // Filter subscriptions by type
  const advisorSubs = subscriptions.filter(s => 
    s.plan.planType === PlanType.ANALYST_SIGNAL_L1 || 
    s.plan.planType === PlanType.ANALYST_SIGNAL_DIAG_L2
  );
  const mentorSubs = subscriptions.filter(s => 
    s.plan.planType === PlanType.MENTOR_WEEKLY_JOURNAL
  );

  // Smart routing logic based on subscriptions
  
  // Only advisor subscriptions → show SignalsDashboard directly
  if (advisorSubs.length > 0 && mentorSubs.length === 0) {
    return (
      <AppLayout>
        <SignalsDashboard 
          subscriptions={advisorSubs}
          userName={user?.name || undefined}
        />
      </AppLayout>
    );
  }

  // Only mentor subscriptions → go to learning dashboard (Phase 3)
  // For now, redirect to the mentor's home page
  if (mentorSubs.length > 0 && advisorSubs.length === 0) {
    // TODO: Phase 3 - Replace with LearningDashboard
    return (
      <AppLayout>
        <div className="p-4 space-y-6 text-center pt-8">
          <h1 className="text-xl font-bold">修煉派｜學習系統</h1>
          <p className="text-muted-foreground">Phase 3 建置中...</p>
          <Button asChild>
            <Link to={`/line/${mentorSubs[0].person.slug}/home`}>
              進入 {mentorSubs[0].person.name} 的學習區
            </Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  // Both types → show mode switcher
  if (advisorSubs.length > 0 && mentorSubs.length > 0) {
    return (
      <AppLayout>
        <ModeSwitcher 
          advisorSubs={advisorSubs}
          mentorSubs={mentorSubs}
          userName={user?.name || undefined}
        />
      </AppLayout>
    );
  }

  // No subscriptions → show empty state
  return (
    <AppLayout>
      <div className="p-4 space-y-6">
        {/* Greeting */}
        <div className="animate-fade-in text-center pt-8">
          <h1 className="text-xl font-bold mb-2">
            嗨，{user?.name || '會員'}
          </h1>
          <p className="text-muted-foreground">歡迎來到會員專區</p>
        </div>

        {/* Empty State */}
        <Card className="text-center py-8">
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">目前尚未訂閱任何服務</p>
            <p className="text-sm text-muted-foreground">
              選擇你的投資風格，跟隨專家一起成長
            </p>
            <Button asChild>
              <Link to="/experts">探索專家</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default AppHome;
