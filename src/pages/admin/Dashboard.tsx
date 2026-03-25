import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { Users, Radio, TrendingUp, DollarSign } from 'lucide-react';
import { AnimatedNumber } from '@/components/AnimatedNumber';

const actionLabels: Record<string, { label: string; className: string }> = {
  buy: { label: '買進', className: 'bg-success text-white border-success' },
  sell: { label: '賣出', className: 'bg-destructive text-white border-destructive' },
};


const AdminDashboard = () => {
  const { user } = useAuth();
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const [expert, setExpert] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeSubscribers, setActiveSubscribers] = useState(0);
  const [monthlyRevenue, setMonthlyRevenue] = useState(0);
  const [totalSignals, setTotalSignals] = useState(0);
  const [thisMonthSignals, setThisMonthSignals] = useState(0);
  const [cumulativeReturn, setCumulativeReturn] = useState<number | null>(null);
  const [avgPnlPercent, setAvgPnlPercent] = useState<number | null>(null);
  const [recentSignals, setRecentSignals] = useState<any[]>([]);
  const [revenueMode, setRevenueMode] = useState<'month' | 'year'>('month');
  const [yearlyRevenue, setYearlyRevenue] = useState(0);

  useEffect(() => { fetchData(); }, [expertSlug]);

  // Realtime subscription for user_summaries
  useEffect(() => {
    if (!user) return;

    // Initial fetch
    supabase
      .from('user_summaries')
      .select('total_pnl_percent, avg_pnl_percent')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setCumulativeReturn((data as any).total_pnl_percent != null ? Number((data as any).total_pnl_percent) : null);
          setAvgPnlPercent(data.avg_pnl_percent != null ? Number(data.avg_pnl_percent) : null);
        }
      });

    const channel = supabase
      .channel('admin-summary-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_summaries',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const row = payload.new as any;
            setCumulativeReturn(row.total_pnl_percent != null ? Number(row.total_pnl_percent) : null);
            setAvgPnlPercent(row.avg_pnl_percent != null ? Number(row.avg_pnl_percent) : null);
          } else if (payload.eventType === 'DELETE') {
            setCumulativeReturn(0);
            setAvgPnlPercent(0);
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const fetchData = async () => {
    if (!expertSlug) return;
    setLoading(true);

    // Get expert
    const { data: exp } = await supabase.from('experts').select('*').eq('slug', expertSlug).single();
    setExpert(exp);
    if (!exp) { setLoading(false); return; }

    // Parallel queries
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();

    const [subsRes, signalsRes, monthSignalsRes, perfRes, recentRes, txMonthRes, txYearRes] = await Promise.all([
      supabase.from('member_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .in('plan_id', 
          (await supabase.from('expert_plans').select('id').eq('expert_id', exp.id)).data?.map(p => p.id) || []
        ),
      supabase.from('expert_signals')
        .select('id', { count: 'exact', head: true })
        .eq('expert_id', exp.id)
        .eq('status', 'published'),
      supabase.from('expert_signals')
        .select('id', { count: 'exact', head: true })
        .eq('expert_id', exp.id)
        .eq('status', 'published')
        .gte('published_at', monthStart),
      supabase.rpc('calculate_expert_performance', { _expert_id: exp.id }),
      supabase.from('expert_signals')
        .select('*')
        .eq('expert_id', exp.id)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(5),
      supabase.from('payment_transactions')
        .select('amount, subscription_id, member_subscriptions!inner(plan_id, expert_plans!inner(expert_id))')
        .eq('status', 'paid')
        .eq('member_subscriptions.expert_plans.expert_id', exp.id)
        .gte('paid_at', monthStart),
      supabase.from('payment_transactions')
        .select('amount, subscription_id, member_subscriptions!inner(plan_id, expert_plans!inner(expert_id))')
        .eq('status', 'paid')
        .eq('member_subscriptions.expert_plans.expert_id', exp.id)
        .gte('paid_at', yearStart),
    ]);

    setActiveSubscribers(subsRes.count || 0);
    setTotalSignals(signalsRes.count || 0);
    setThisMonthSignals(monthSignalsRes.count || 0);
    
    // cumulative return now comes from user_summaries realtime subscription

    setRecentSignals(recentRes.data || []);

    const mRevenue = (txMonthRes.data || []).reduce((s: number, t: any) => s + (t.amount || 0), 0);
    setMonthlyRevenue(mRevenue);
    const yRevenue = (txYearRes.data || []).reduce((s: number, t: any) => s + (t.amount || 0), 0);
    setYearlyRevenue(yRevenue);

    setLoading(false);
  };


  if (loading) return <AdminLayout><div className="flex items-center justify-center h-64 text-muted-foreground">載入中...</div></AdminLayout>;
  if (!expert) return <AdminLayout><div /></AdminLayout>;

  const isAdvisor = expert.role === 'advisor';

  const stats = [
    {
      label: '活躍訂閱者',
      value: activeSubscribers,
      change: '',
      changeType: 'neutral' as const,
      icon: Users,
    },
    {
      label: revenueMode === 'month' ? '本月營收' : '年度營收',
      value: revenueMode === 'month'
        ? `NT$${monthlyRevenue.toLocaleString()}`
        : `NT$${yearlyRevenue.toLocaleString()}`,
      change: '',
      changeType: 'neutral' as const,
      icon: DollarSign,
      hasToggle: true,
    },
    {
      label: '累計發布訊號',
      value: totalSignals,
      change: '',
      changeType: 'neutral' as const,
      icon: Radio,
    },
    {
      label: '累計報酬率',
      value: cumulativeReturn,
      change: '',
      changeType: 'neutral' as const,
      icon: TrendingUp,
      isAnimatedPnl: true,
    },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">後台總覽</h1>
          <p className="text-muted-foreground text-sm mt-1">
            歡迎回來，{expert.name}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <Card key={stat.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">{stat.label}</span>
                  <div className="flex items-center gap-1">
                    {stat.hasToggle && (
                      <div className="flex items-center bg-muted rounded-md p-0.5 mr-1">
                        <button
                          onClick={() => setRevenueMode('month')}
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded transition-colors",
                            revenueMode === 'month' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                          )}
                        >月</button>
                        <button
                          onClick={() => setRevenueMode('year')}
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded transition-colors",
                            revenueMode === 'year' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                          )}
                        >年</button>
                      </div>
                    )}
                    <stat.icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
                <div className="text-2xl font-bold">
                  {(stat as any).isAnimatedPnl ? (
                    <AnimatedNumber
                      value={stat.value as number | null}
                      format={(v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`}
                      className={cn(
                        (stat.value as number | null) != null && (stat.value as number) > 0
                          ? 'text-red-600 dark:text-red-400'
                          : (stat.value as number | null) != null && (stat.value as number) < 0
                            ? 'text-green-600 dark:text-green-400'
                            : ''
                      )}
                    />
                  ) : (
                    stat.value
                  )}
                </div>
                {stat.change && (
                  <div className="text-xs mt-1 text-muted-foreground">{stat.change}</div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>


        <Card>
          <CardHeader>
            <CardTitle className="text-base">最近發布的{isAdvisor ? '訊號' : '週記'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentSignals.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">尚無{isAdvisor ? '訊號' : '週記'}</p>
              ) : (
                recentSignals.map((signal) => {
                  const ai = actionLabels[signal.action] || actionLabels.buy;
                  return (
                      <div key={signal.id} className="flex items-center justify-between py-2 border-b last:border-0">
                        <div className="flex items-center gap-3">
                          <Badge className={`${ai.className} w-12 justify-center text-xs`}>{ai.label}</Badge>
                        <div>
                          <p className="font-medium text-sm">{signal.instrument}</p>
                          <p className="text-xs text-muted-foreground">
                            {signal.published_at ? new Date(signal.published_at).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">已發布</Badge>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default AdminDashboard;
