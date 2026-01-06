import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { SignalCard } from '@/components/SignalCard';
import { useAuth } from '@/contexts/AuthContext';
import { getSignalsForUser, getUserSubscriptions, people } from '@/data/mockData';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Radio, ExternalLink } from 'lucide-react';
import { PlanType } from '@/types';
import { markAppSignalsAsRead } from '@/components/layouts/SignalsLayout';

const Signals = () => {
  // Mark signals as read when entering this page
  useEffect(() => {
    markAppSignalsAsRead();
  }, []);
  const { user } = useAuth();
  const signals = user ? getSignalsForUser(user.id) : [];
  const subscriptions = user ? getUserSubscriptions(user.id) : [];
  
  // Get advisor subscriptions for quick links
  const advisorSubs = subscriptions.filter(s => 
    s.plan.planType === PlanType.ANALYST_SIGNAL_L1 || 
    s.plan.planType === PlanType.ANALYST_SIGNAL_DIAG_L2
  );

  return (
    <AppLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Radio className="h-5 w-5 text-advisor" />
          <h1 className="text-xl font-bold">我的投顧訊號牆</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          來自您訂閱的投顧分析師的即時策略訊號
        </p>

        {/* Quick links to individual expert LINE apps */}
        {advisorSubs.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {advisorSubs.map(sub => (
              <Button key={sub.id} variant="outline" size="sm" asChild>
                <Link to={`/line/${sub.person.slug}/signals`}>
                  {sub.person.name}
                  <ExternalLink className="h-3 w-3 ml-1" />
                </Link>
              </Button>
            ))}
          </div>
        )}
        
        {signals.length > 0 ? (
          <div className="space-y-3">
            {signals.map(signal => (
              <SignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              目前沒有新的訊號
            </CardContent>
          </Card>
        )}

        {/* Note about LINE apps */}
        <div className="p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
          <p>💡 建議使用各老師專屬的 LINE 服務查看完整訊號內容與解說。</p>
        </div>
      </div>
    </AppLayout>
  );
};

export default Signals;
