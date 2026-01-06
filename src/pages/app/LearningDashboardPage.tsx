import { Navigate } from 'react-router-dom';
import { UnifiedAppLayout } from '@/components/layouts/UnifiedAppLayout';
import { LearningDashboard } from '@/pages/app/LearningDashboard';
import { useAuth } from '@/contexts/AuthContext';
import { getUserSubscriptions } from '@/data/mockData';
import { PlanType } from '@/types';

const LearningDashboardPage = () => {
  const { user, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">載入中...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth/login" replace />;
  }

  const subscriptions = getUserSubscriptions(user.id);
  const mentorSubs = subscriptions.filter(s => 
    s.plan.planType === PlanType.MENTOR_WEEKLY_JOURNAL
  );

  // If no mentor subscriptions, redirect to home
  if (mentorSubs.length === 0) {
    return <Navigate to="/app" replace />;
  }

  return (
    <UnifiedAppLayout>
      <LearningDashboard 
        subscriptions={mentorSubs}
        userName={user.name}
      />
    </UnifiedAppLayout>
  );
};

export default LearningDashboardPage;
