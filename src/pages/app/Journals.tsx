import { useEffect } from 'react';
import { UnifiedAppLayout, markAppJournalsAsRead } from '@/components/layouts/UnifiedAppLayout';
import { JournalCard } from '@/components/JournalCard';
import { useAuth } from '@/contexts/AuthContext';
import { getJournalsForUser } from '@/data/mockData';
import { Card, CardContent } from '@/components/ui/card';
import { BookOpen } from 'lucide-react';

const Journals = () => {
  // Mark journals as read when entering this page
  useEffect(() => {
    markAppJournalsAsRead();
  }, []);

  const { user } = useAuth();
  const journals = user ? getJournalsForUser(user.id) : [];

  return (
    <UnifiedAppLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="h-5 w-5 text-learning-accent" />
          <h1 className="text-xl font-bold">實戰週記教學</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          來自您訂閱的實戰導師的 T+7 週記
        </p>
        
        {journals.length > 0 ? (
          <div className="space-y-3">
            {journals.map(journal => (
              <JournalCard key={journal.id} journal={journal} to={`/app/journal/${journal.id}`} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              目前尚未訂閱任何實戰導師
            </CardContent>
          </Card>
        )}
      </div>
    </UnifiedAppLayout>
  );
};

export default Journals;
