import { AppLayout } from '@/components/layouts/AppLayout';
import { SignalCard } from '@/components/SignalCard';
import { useAuth } from '@/contexts/AuthContext';
import { getSignalsForUser } from '@/data/mockData';
import { Card, CardContent } from '@/components/ui/card';
import { Radio } from 'lucide-react';

const Signals = () => {
  const { user } = useAuth();
  const signals = user ? getSignalsForUser(user.id) : [];

  return (
    <AppLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Radio className="h-5 w-5 text-advisor" />
          <h1 className="text-xl font-bold">我的投顧訊號牆</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-4">來自您訂閱的投顧分析師的即時策略訊號</p>
        
        {signals.length > 0 ? (
          <div className="space-y-3">
            {signals.map(signal => (
              <SignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        ) : (
          <Card><CardContent className="p-6 text-center text-muted-foreground">目前沒有新的訊號</CardContent></Card>
        )}
      </div>
    </AppLayout>
  );
};

export default Signals;
