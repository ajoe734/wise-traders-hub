import { Navigate } from 'react-router-dom';
import { UnifiedAppLayout } from '@/components/layouts/UnifiedAppLayout';
import { SignalsDashboard } from '@/pages/app/SignalsDashboard';
import { useAuth } from '@/contexts/AuthContext';
import { getUserSubscriptions } from '@/data/mockData';
import { PlanType } from '@/types';

const SignalsDashboardPage = () => {
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
  const advisorSubs = subscriptions.filter(s => 
    s.plan.planType === PlanType.ANALYST_SIGNAL_L1 || 
    s.plan.planType === PlanType.ANALYST_SIGNAL_DIAG_L2
  );

  // If no advisor subscriptions, redirect to home
  if (advisorSubs.length === 0) {
    return <Navigate to="/app" replace />;
  }

  return (
    <UnifiedAppLayout>
      <SignalsDashboard 
        subscriptions={advisorSubs}
        userName={user.name}
      />
    </UnifiedAppLayout>
  );
};

export default SignalsDashboardPage;
