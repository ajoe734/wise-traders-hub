import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { JournalCard } from '@/components/JournalCard';
import { useAuth } from '@/contexts/AuthContext';
import { getJournalsForUser, getUserSubscriptions } from '@/data/mockData';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BookOpen, ExternalLink } from 'lucide-react';
import { PlanType } from '@/types';
import { markAppJournalsAsRead } from '@/components/layouts/LearningLayout';

const Journals = () => {
  // Mark journals as read when entering this page
  useEffect(() => {
    markAppJournalsAsRead();
  }, []);
  const { user } = useAuth();
  const journals = user ? getJournalsForUser(user.id) : [];
  const subscriptions = user ? getUserSubscriptions(user.id) : [];
  
  // Get mentor subscriptions for quick links
  const mentorSubs = subscriptions.filter(s => 
    s.plan.planType === PlanType.MENTOR_WEEKLY_JOURNAL
  );

  return (
    <AppLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="h-5 w-5 text-mentor" />
          <h1 className="text-xl font-bold">實戰週記教學</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          來自您訂閱的實戰導師的 T+7 週記
        </p>

        {/* Quick links to individual expert LINE apps */}
        {mentorSubs.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {mentorSubs.map(sub => (
              <Button key={sub.id} variant="outline" size="sm" asChild>
                <Link to={`/line/${sub.person.slug}/signals`}>
                  {sub.person.name}
                  <ExternalLink className="h-3 w-3 ml-1" />
                </Link>
              </Button>
            ))}
          </div>
        )}
        
        {journals.length > 0 ? (
          <div className="space-y-3">
            {journals.map(journal => (
              <JournalCard key={journal.id} journal={journal} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              目前尚未訂閱任何實戰導師
            </CardContent>
          </Card>
        )}

        {/* Note about LINE apps */}
        <div className="p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
          <p>💡 建議使用各老師專屬的 LINE 服務查看完整週記內容。</p>
        </div>
      </div>
    </AppLayout>
  );
};

export default Journals;
