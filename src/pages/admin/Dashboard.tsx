import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { Users, Radio, TrendingUp, DollarSign, BookOpen, ArrowRight, Wallet } from 'lucide-react';
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

  // Fetch total return from calculate_expert_performance RPC
  const fetchPerfStats = async (eid: string) => {
    const { data } = await supabase.rpc('calculate_expert_performance', { _expert_id: eid });
    if (data) {
      const d = data as any;
      const totalRet = d.total_return_pct ?? d.cumulative_return ?? 0;
      setCumulativeReturn(Number(totalRet));
      setAvgPnlPercent(d.avg_pnl != null ? Number(d.avg_pnl) : 0);
    }
  };

  useEffect(() => {
    if (!expert?.id) return;
    fetchPerfStats(expert.id);

    // Realtime: recalculate when trade_records change
    const channel = supabase
      .channel('admin-dashboard-trade-records')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trade_records', filter: `expert_id=eq.${expert.id}` },
        () => { fetchPerfStats(expert.id); },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [expert?.id]);

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
        .in('status', ['published', 'pending']),
      supabase.from('expert_signals')
        .select('id', { count: 'exact', head: true })
        .eq('expert_id', exp.id)
        .in('status', ['published', 'pending'])
        .gte('created_at', monthStart),
      supabase.rpc('calculate_expert_performance', { _expert_id: exp.id }),
      supabase.from('expert_signals')
        .select('*')
        .eq('expert_id', exp.id)
        .in('status', ['published', 'pending'])
        .order('created_at', { ascending: false })
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
    
    // Use RPC result for total return
    if (perfRes.data) {
      const pd = perfRes.data as any;
      const totalRet = pd.total_return_pct ?? pd.cumulative_return ?? 0;
      setCumulativeReturn(Number(totalRet));
      setAvgPnlPercent(pd.avg_pnl != null ? Number(pd.avg_pnl) : 0);
    }

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
      label: '總報酬率',
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
        {!isAdvisor && (
          <Card className="border-mentor/30 bg-mentor/5">
            <CardContent className="p-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-mentor/15 flex items-center justify-center shrink-0">
                  <BookOpen className="h-5 w-5 text-mentor" />
                </div>
                <div>
                  <h3 className="font-semibold">📓 撰寫本週週記</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    週記儲存後狀態為「待發布」，週五 20:00 由系統自動上線
                  </p>
                </div>
              </div>
              <Button asChild size="sm" className="bg-mentor hover:bg-mentor/90 shrink-0">
                <Link to={`/admin/${expertSlug}/signals`}>
                  前往撰寫<ArrowRight className="h-4 w-4 ml-1" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}


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
                            {signal.created_at ? new Date(signal.created_at).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                          </p>
                        </div>
                      </div>
                      {signal.status === 'pending' ? (
                        <Badge className="text-xs border border-amber-400/40 bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">待發布</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">已發布</Badge>
                      )}
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
