import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { UnifiedAppLayout, markAppJournalsAsRead } from '@/components/layouts/UnifiedAppLayout';
import { JournalCard } from '@/components/JournalCard';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { BookOpen, CalendarDays, Loader2 } from 'lucide-react';
import { format, startOfWeek, endOfWeek } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

interface JournalSignal {
  id: string;
  instrument: string;
  action: string;
  price_hint: number | null;
  reason_summary: string | null;
  reason_detail: string | null;
  risk_notes: string | null;
  learning_points: string | null;
  published_at: string;
  expert_id: string;
  experts: {
    name: string;
    slug: string;
    role: string;
    avatar_url: string | null;
  };
}

interface WeekGroup {
  weekStart: Date;
  weekEnd: Date;
  signals: JournalSignal[];
  expert: JournalSignal['experts'];
}

const Journals = () => {
  const [signals, setSignals] = useState<JournalSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasSubscription, setHasSubscription] = useState<boolean | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>('all');

  useEffect(() => {
    markAppJournalsAsRead();
  }, []);

  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    fetchJournals();
  }, [user]);

  const fetchJournals = async () => {
    if (!user) return;
    setLoading(true);

    // 1. Get mentor expert_ids the user is subscribed to
    const { data: subs } = await supabase
      .rpc('has_active_subscription', { _user_id: user.id });

    if (!subs || subs.length === 0) {
      setSignals([]);
      setHasSubscription(false);
      setLoading(false);
      return;
    }

    setHasSubscription(true);

    const expertIds = subs.map((s: any) => s.expert_id);

    // Filter to active mentor experts only
    const { data: mentorExperts } = await supabase
      .from('experts')
      .select('id')
      .in('id', expertIds)
      .eq('role', 'mentor')
      .eq('status', 'active');

    const mentorIds = (mentorExperts || []).map(e => e.id);
    if (mentorIds.length === 0) {
      setSignals([]);
      setLoading(false);
      return;
    }

    // 2. Query expert_signals for mentor journals
    const { data, error } = await supabase
      .from('expert_signals')
      .select('id, instrument, action, price_hint, reason_summary, reason_detail, risk_notes, learning_points, published_at, expert_id, experts(name, slug, role, avatar_url)')
      .eq('status', 'published')
      .in('expert_id', mentorIds)
      .order('published_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Error fetching journals:', error);
    }
    setSignals((data as any) || []);
    setLoading(false);
  };

  // Group signals by week
  const weekGroups = useMemo(() => {
    const groups: Map<string, WeekGroup> = new Map();
    signals.forEach(signal => {
      const pubDate = new Date(signal.published_at);
      const ws = startOfWeek(pubDate, { weekStartsOn: 1 });
      const we = endOfWeek(pubDate, { weekStartsOn: 1 });
      const key = `${signal.expert_id}-${format(ws, 'yyyy-MM-dd')}`;
      if (!groups.has(key)) {
        groups.set(key, { weekStart: ws, weekEnd: we, signals: [], expert: signal.experts });
      }
      groups.get(key)!.signals.push(signal);
    });
    return Array.from(groups.values()).sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime());
  }, [signals]);

  // Available months
  const availableMonths = useMemo(() => {
    const monthSet = new Set<string>();
    weekGroups.forEach(g => {
      monthSet.add(format(g.weekStart, 'yyyy-MM'));
    });
    return Array.from(monthSet).sort().reverse();
  }, [weekGroups]);

  // Filter by month
  const filteredGroups = useMemo(() => {
    if (selectedMonth === 'all') return weekGroups;
    return weekGroups.filter(g => format(g.weekStart, 'yyyy-MM') === selectedMonth);
  }, [weekGroups, selectedMonth]);

  return (
    <UnifiedAppLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="h-5 w-5 text-mentor" />
          <h1 className="text-xl font-bold">修煉派週記教學</h1>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            來自您訂閱導師的修煉派週記
          </p>
          
          {weekGroups.length > 0 && (
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
        
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : weekGroups.length > 0 ? (
          filteredGroups.length > 0 ? (
            <div className="space-y-3">
              {filteredGroups.map(group => (
                <JournalCard
                  key={`${group.expert.slug}-${format(group.weekStart, 'yyyy-MM-dd')}`}
                  weekStart={group.weekStart}
                  weekEnd={group.weekEnd}
                  signals={group.signals}
                  expert={group.expert}
                  to={`/app/journal/${group.signals[0].id}`}
                />
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
        ) : hasSubscription === false ? (
          <Card>
            <CardContent className="p-6 text-center space-y-3">
              <p className="text-muted-foreground">您尚未訂閱任何實戰導師</p>
              <p className="text-sm text-muted-foreground">訂閱後即可在此查看修煉派週記教學</p>
              <Link to="/app/explore">
                <button className="mt-2 inline-flex items-center gap-2 rounded-md bg-learning-accent px-6 py-2.5 text-sm font-medium text-white hover:bg-learning-accent/90">
                  前往探索導師
                </button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              目前沒有新的週記
            </CardContent>
          </Card>
        )}
      </div>
    </UnifiedAppLayout>
  );
};

export default Journals;
