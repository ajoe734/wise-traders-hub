import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { UnifiedAppLayout, markAppSignalsAsRead } from '@/components/layouts/UnifiedAppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Radio, Clock, ChevronRight } from 'lucide-react';
import { format, isToday, differenceInHours } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';

const actionConfig: Record<string, { label: string; className: string }> = {
  buy: { label: '買進', className: 'bg-success text-white border-success' },
  sell: { label: '賣出', className: 'bg-destructive text-white border-destructive' },
  add: { label: '加碼', className: 'bg-blue-500 text-blue-50 border-blue-500' },
  trim: { label: '減碼', className: 'bg-amber-500 text-amber-50 border-amber-500' },
  exit: { label: '平損', className: 'bg-slate-500 text-slate-50 border-slate-500' },
};

interface DbSignal {
  id: string;
  instrument: string;
  action: string;
  price_hint: number | null;
  reason_summary: string | null;
  risk_notes: string | null;
  published_at: string | null;
  status: string;
  expert_id: string;
  plan_id: string | null;
  experts: {
    name: string;
    slug: string;
    role: string;
    avatar_url: string | null;
  } | null;
}

const fetchSignalsData = async (userId: string | undefined) => {
  if (!userId) return { signals: [] as DbSignal[], hasSubscription: false };

  const { data: activeSubs, error: subsError } = await supabase
    .from('member_subscriptions')
    .select('plan_id, expert_plans(expert_id)')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (subsError) {
    console.error('Error fetching subscriptions:', subsError);
    return { signals: [] as DbSignal[], hasSubscription: false };
  }

  const expertIds = (activeSubs || [])
    .map((s: any) => s.expert_plans?.expert_id)
    .filter(Boolean);

  if (expertIds.length === 0) return { signals: [] as DbSignal[], hasSubscription: false };

  // Only show advisor signals in the signal wall, not mentor weekly reviews
  // Also filter out suspended experts
  const { data: advisorExperts, error: advisorError } = await supabase
    .from('experts')
    .select('id')
    .in('id', expertIds)
    .eq('role', 'advisor')
    .eq('status', 'active');

  if (advisorError) {
    console.error('Error fetching advisor experts:', advisorError);
    return { signals: [] as DbSignal[], hasSubscription: false };
  }

  const advisorExpertIds = (advisorExperts || []).map(e => e.id);
  if (advisorExpertIds.length === 0) return { signals: [] as DbSignal[], hasSubscription: false };

  const { data, error } = await supabase
    .from('expert_signals')
    .select('id, instrument, action, price_hint, reason_summary, risk_notes, published_at, status, expert_id, plan_id, experts(name, slug, role, avatar_url)')
    .eq('status', 'published')
    .in('expert_id', advisorExpertIds)
    .order('published_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Error fetching signals:', error);
  }

  return {
    signals: (!error && data ? data : []) as unknown as DbSignal[],
    hasSubscription: true,
  };
};

const Signals = () => {
  const { user } = useAuth();

  const { data, isLoading: loading } = useQuery({
    queryKey: ['app-signals', user?.id],
    queryFn: () => fetchSignalsData(user?.id),
    staleTime: 30_000,
    refetchOnMount: 'always',
  });

  const signals = data?.signals ?? [];
  const hasSubscription = data?.hasSubscription ?? null;

  useEffect(() => {
    markAppSignalsAsRead();
  }, []);

  return (
    <UnifiedAppLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Radio className="h-5 w-5 text-signals-accent" />
          <h1 className="text-xl font-bold">我的投顧訊號牆</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          來自您訂閱的投顧分析師的即時策略訊號
        </p>

        {loading ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">載入中...</CardContent>
          </Card>
        ) : signals.length > 0 ? (
          <div className="space-y-3">
            {signals.map(signal => {
              const ac = actionConfig[signal.action] || actionConfig.buy;
              const publishedAt = signal.published_at ? new Date(signal.published_at) : new Date();
              const isRecent = differenceInHours(new Date(), publishedAt) < 24;

              return (
                <Link key={signal.id} to={`/app/signal/${signal.id}`}>
                  <Card variant="interactive" className="overflow-hidden mb-3">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          <span>{format(publishedAt, 'MM/dd HH:mm', { locale: zhTW })}</span>
                        </div>
                        {isToday(publishedAt) ? (
                          <Badge variant="success-light" className="text-[10px]">即時</Badge>
                        ) : isRecent ? (
                          <Badge variant="warning-light" className="text-[10px]">近期</Badge>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-3 mb-3">
                        <Badge className={cn(ac.className, 'text-xs px-2 py-0.5')}>{ac.label}</Badge>
                        <span className="font-semibold text-lg">{signal.instrument}</span>
                      </div>

                      {signal.experts && (
                        <div className="flex items-center gap-2 mb-3">
                          <img
                            src={signal.experts.avatar_url || '/placeholder.svg'}
                            alt={signal.experts.name}
                            className="h-6 w-6 rounded-full object-cover"
                          />
                          <span className="text-sm text-muted-foreground">{signal.experts.name}</span>
                         <Badge className="text-[10px] px-2 py-0.5" style={{ backgroundColor: 'hsl(0,25%,16%)', color: '#ffffff', borderColor: 'hsl(0,35%,28%)' }}>
                            {signal.experts.role === 'advisor' ? '投顧分析師' : '實戰導師'}
                          </Badge>
                        </div>
                      )}

                      {signal.reason_summary && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{signal.reason_summary.replace(/^[•·]\s*/gm, '')}</p>
                      )}

                      {signal.risk_notes && (
                        <div className="bg-warning-light/50 rounded-lg p-2.5 text-xs text-warning mb-3">
                          💡 {signal.risk_notes.replace(/^[•·]\s*/gm, '').slice(0, 50)}{signal.risk_notes.length > 50 ? '...' : ''}
                        </div>
                      )}

                      <div className="flex items-center justify-end text-sm text-muted-foreground font-medium">
                        查看詳解與教學
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        ) : hasSubscription === false ? (
          <Card>
            <CardContent className="p-6 text-center space-y-3">
              <p className="text-muted-foreground">您尚未訂閱任何分析師</p>
              <p className="text-sm text-muted-foreground">訂閱後即可在此查看即時投顧訊號</p>
              <Link to="/app/explore">
                <button className="mt-2 inline-flex items-center gap-2 rounded-md bg-signals-accent px-6 py-2.5 text-sm font-medium text-white hover:bg-signals-accent/90">
                  前往探索分析師
                </button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              目前沒有新的訊號
            </CardContent>
          </Card>
        )}
      </div>
    </UnifiedAppLayout>
  );
};

export default Signals;
