import { useState, useEffect, useMemo } from 'react';
import { UnifiedAppLayout, markAppJournalsAsRead } from '@/components/layouts/UnifiedAppLayout';
import { JournalCard } from '@/components/JournalCard';
import { useAuth } from '@/contexts/AuthContext';
import { getJournalsForUser } from '@/data/mockData';
import { Card, CardContent } from '@/components/ui/card';
import { BookOpen, CalendarDays } from 'lucide-react';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

const Journals = () => {
  const [selectedMonth, setSelectedMonth] = useState<string>('all');

  // Mark journals as read when entering this page
  useEffect(() => {
    markAppJournalsAsRead();
  }, []);

  const { user } = useAuth();
  const journals = user ? getJournalsForUser(user.id) : [];

  // Calculate available months from journals
  const availableMonths = useMemo(() => {
    const monthSet = new Set<string>();
    journals.forEach(journal => {
      const monthKey = format(journal.weekStart, 'yyyy-MM');
      monthSet.add(monthKey);
    });
    return Array.from(monthSet).sort().reverse(); // newest first
  }, [journals]);

  // Filter journals by selected month
  const filteredJournals = useMemo(() => {
    if (selectedMonth === 'all') return journals;
    
    return journals.filter(journal => {
      const journalMonth = format(journal.weekStart, 'yyyy-MM');
      return journalMonth === selectedMonth;
    });
  }, [journals, selectedMonth]);

  return (
    <UnifiedAppLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="h-5 w-5 text-learning-accent" />
          <h1 className="text-xl font-bold">修煉派週記教學</h1>
        </div>
        
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            來自您訂閱導師的 T+7 修煉派週記
          </p>
          
          {journals.length > 0 && (
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[140px] h-8 text-sm">
                <CalendarDays className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="選擇月份" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部月份</SelectItem>
                {availableMonths.map(month => (
                  <SelectItem key={month} value={month}>
                    {format(new Date(month + '-01'), 'yyyy 年 M 月', { locale: zhTW })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        
        {journals.length > 0 ? (
          filteredJournals.length > 0 ? (
            <div className="space-y-3">
              {filteredJournals.map(journal => (
                <JournalCard key={journal.id} journal={journal} to={`/app/journal/${journal.id}`} />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                <CalendarDays className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>{format(new Date(selectedMonth + '-01'), 'yyyy 年 M 月', { locale: zhTW })} 沒有週記</p>
                <Button variant="ghost" size="sm" onClick={() => setSelectedMonth('all')} className="mt-2">
                  顯示全部週記
                </Button>
              </CardContent>
            </Card>
          )
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
