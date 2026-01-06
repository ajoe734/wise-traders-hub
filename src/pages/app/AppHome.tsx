import { useState } from 'react';
import { Link } from 'react-router-dom';
import { UnifiedAppLayout } from '@/components/layouts/UnifiedAppLayout';
import { ModeSwitcher, AppMode } from '@/pages/app/ModeSwitcher';
import { SignalsDashboard } from '@/pages/app/SignalsDashboard';
import { LearningDashboard } from '@/pages/app/LearningDashboard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { getUserSubscriptions } from '@/data/mockData';
import { PlanType } from '@/types';

const AppHome = () => {
  const { user } = useAuth();
  const subscriptions = user ? getUserSubscriptions(user.id) : [];
  const [selectedMode, setSelectedMode] = useState<AppMode | null>(null);
  
  // Filter subscriptions by type
  const advisorSubs = subscriptions.filter(s => 
    s.plan.planType === PlanType.ANALYST_SIGNAL_L1 || 
    s.plan.planType === PlanType.ANALYST_SIGNAL_DIAG_L2
  );
  const mentorSubs = subscriptions.filter(s => 
    s.plan.planType === PlanType.MENTOR_WEEKLY_JOURNAL
  );

  // Smart routing logic based on subscriptions
  
  // Only advisor subscriptions → show SignalsDashboard
  if (advisorSubs.length > 0 && mentorSubs.length === 0) {
    return (
      <UnifiedAppLayout>
        <SignalsDashboard 
          subscriptions={advisorSubs}
          userName={user?.name || undefined}
        />
      </UnifiedAppLayout>
    );
  }

  // Only mentor subscriptions → show LearningDashboard
  if (mentorSubs.length > 0 && advisorSubs.length === 0) {
    return (
      <UnifiedAppLayout>
        <LearningDashboard 
          subscriptions={mentorSubs}
          userName={user?.name || undefined}
        />
      </UnifiedAppLayout>
    );
  }

  // Both types → show mode switcher or selected dashboard
  if (advisorSubs.length > 0 && mentorSubs.length > 0) {
    // User selected signals mode
    if (selectedMode === 'signals') {
      return (
        <UnifiedAppLayout>
          <SignalsDashboard 
            subscriptions={advisorSubs}
            userName={user?.name || undefined}
          />
        </UnifiedAppLayout>
      );
    }
    
    // User selected learning mode
    if (selectedMode === 'learning') {
      return (
        <UnifiedAppLayout>
          <LearningDashboard 
            subscriptions={mentorSubs}
            userName={user?.name || undefined}
          />
        </UnifiedAppLayout>
      );
    }
    
    // No mode selected yet → show mode switcher
    return (
      <UnifiedAppLayout>
        <ModeSwitcher 
          advisorSubs={advisorSubs}
          mentorSubs={mentorSubs}
          userName={user?.name || undefined}
          onSelectMode={setSelectedMode}
        />
      </UnifiedAppLayout>
    );
  }

  // No subscriptions → show empty state
  return (
    <UnifiedAppLayout>
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
    </UnifiedAppLayout>
  );
};

export default AppHome;
