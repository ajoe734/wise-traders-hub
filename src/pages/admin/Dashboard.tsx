import { SEO } from '@/components/SEO';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Users, Radio, TrendingUp, DollarSign, BookOpen, ArrowRight, Wallet } from 'lucide-react';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { getActionMeta, getSignalDisplayInstrument } from '@/lib/signalAction';

const AdminDashboard = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const [revenueMode, setRevenueMode] = useState<'month' | 'year'>('month');

  // Main aggregate query
  const { data: agg, isLoading: loading, refetch: refetchAgg } = useQuery({
    queryKey: ['admin', 'dashboard', expertSlug ?? null],
    enabled: !!expertSlug,
    staleTime: 30_000,
    queryFn: async () => {
      const { data: exp } = await supabase.from('experts').select('*').eq('slug', expertSlug!).single();
      if (!exp) return null;
      const now = new Date();
      const nowIso = now.toISOString();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();

      const planIds = (await supabase.from('expert_plans').select('id').eq('expert_id', exp.id)).data?.map(p => p.id) || [];

      const [subsRes, signalsRes, monthSignalsRes, perfRes, recentRes, txMonthRes, txYearRes] = await Promise.all([
        supabase.from('member_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active').or(`expires_at.is.null,expires_at.gt.${nowIso}`).in('plan_id', planIds.length ? planIds : ['00000000-0000-0000-0000-000000000000']),
        supabase.from('expert_signals').select('id', { count: 'exact', head: true }).eq('expert_id', exp.id).in('status', ['published', 'pending']),
        supabase.from('expert_signals').select('id', { count: 'exact', head: true }).eq('expert_id', exp.id).in('status', ['published', 'pending']).gte('created_at', monthStart),
        supabase.rpc('calculate_expert_performance', { _expert_id: exp.id }),
        supabase.from('expert_signals').select('*').eq('expert_id', exp.id).in('status', ['published', 'pending']).order('created_at', { ascending: false }).limit(5),
        supabase.from('payment_transactions').select('amount, subscription_id, member_subscriptions!inner(plan_id, expert_plans!inner(expert_id))').eq('status', 'paid').eq('member_subscriptions.expert_plans.expert_id', exp.id).gte('paid_at', monthStart),
        supabase.from('payment_transactions').select('amount, subscription_id, member_subscriptions!inner(plan_id, expert_plans!inner(expert_id))').eq('status', 'paid').eq('member_subscriptions.expert_plans.expert_id', exp.id).gte('paid_at', yearStart),
      ]);

      const pd = (perfRes.data as any) || {};
      return {
        expert: exp,
        activeSubscribers: subsRes.count || 0,
        totalSignals: signalsRes.count || 0,
        thisMonthSignals: monthSignalsRes.count || 0,
        cumulativeReturn: Number(pd.total_return_pct ?? 0),
        avgPnlPercent: pd.avg_pnl_pct != null ? Number(pd.avg_pnl_pct) : 0,
        recentSignals: recentRes.data || [],
        monthlyRevenue: (txMonthRes.data || []).reduce((s: number, t: any) => s + (t.amount || 0), 0),
        yearlyRevenue: (txYearRes.data || []).reduce((s: number, t: any) => s + (t.amount || 0), 0),
      };
    },
  });

  const expert = agg?.expert;
  const expertId = expert?.id;

  // Capital status (separate query, lighter polling)
  const { data: capital } = useQuery({
    queryKey: ['admin', 'capital', expertId ?? null],
    enabled: !!expertId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase.rpc('get_expert_capital_status' as any, { _expert_id: expertId! });
      return (data as any) || null;
    },
  });

  // Realtime: re-run aggregate (covers perf + capital) when trade_records change
  useEffect(() => {
    if (!expertId) return;
    const channel = supabase
      .channel('admin-dashboard-trade-records')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trade_records', filter: `expert_id=eq.${expertId}` }, () => {
        refetchAgg();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [expertId, refetchAgg]);

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-64 text-muted-foreground">載入中...</div></AdminLayout>;
  if (!expert) return <AdminLayout><div /></AdminLayout>;

  const isAdvisor = expert.role === 'advisor';
  const cumulativeReturn = agg?.cumulativeReturn ?? null;

  const stats = [
    { label: '活躍訂閱者', value: agg?.activeSubscribers ?? 0, icon: Users },
    {
      label: revenueMode === 'month' ? '本月營收' : '年度營收',
      value: revenueMode === 'month'
        ? `NT$${(agg?.monthlyRevenue ?? 0).toLocaleString()}`
        : `NT$${(agg?.yearlyRevenue ?? 0).toLocaleString()}`,
      icon: DollarSign,
      hasToggle: true,
    },
    { label: '累計發布訊號', value: agg?.totalSignals ?? 0, icon: Radio },
    { label: '總報酬率', value: cumulativeReturn, icon: TrendingUp, isAnimatedPnl: true },
  ];

  return (
    <AdminLayout>
      <SEO title={`${expertSlug || ''} 管理首頁 | legendflow`} description={'專家後台首頁：訊號、訂閱、績效總覽。'} path={`/admin/${expertSlug || ''}`} noindex />
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">後台總覽</h1>
          <p className="text-muted-foreground text-sm mt-1">歡迎回來，{expert.name}</p>
        </div>

        {capital && (
          <Card className="border-primary/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wallet className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">資金狀況</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">起始資金</div>
                  <div className="text-base font-semibold tabular-nums">${(capital.starting_capital || 0).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">可用現金</div>
                  <div className={cn('text-lg font-bold tabular-nums', capital.available_cash < 0 ? 'text-destructive' : 'text-foreground')}>
                    ${(capital.available_cash || 0).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">未平倉成本</div>
                  <div className="text-base font-semibold tabular-nums">${(capital.open_cost_value || 0).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">已實現損益</div>
                  <div className={cn('text-base font-semibold tabular-nums',
                    capital.realized_pnl_amount > 0 ? 'text-red-600 dark:text-red-400' :
                    capital.realized_pnl_amount < 0 ? 'text-green-600 dark:text-green-400' : '')}>
                    {capital.realized_pnl_amount > 0 ? '+' : ''}${(capital.realized_pnl_amount || 0).toLocaleString()}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <Card key={stat.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">{stat.label}</span>
                  <div className="flex items-center gap-1">
                    {(stat as any).hasToggle && (
                      <div className="flex items-center bg-muted rounded-md p-0.5 mr-1">
                        <button onClick={() => setRevenueMode('month')} className={cn("text-[10px] px-1.5 py-0.5 rounded transition-colors", revenueMode === 'month' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}>月</button>
                        <button onClick={() => setRevenueMode('year')} className={cn("text-[10px] px-1.5 py-0.5 rounded transition-colors", revenueMode === 'year' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}>年</button>
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
                    週記儲存後狀態為「待發布」，本週五 20:00 統一開放發布
                  </p>
                </div>
              </div>
              <Button asChild size="sm" className="bg-mentor hover:bg-mentor/90 shrink-0">
                <Link to={`/admin/${expertSlug}/signals`}>前往撰寫<ArrowRight className="h-4 w-4 ml-1" /></Link>
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
              {(agg?.recentSignals.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">尚無{isAdvisor ? '訊號' : '週記'}</p>
              ) : (
                agg!.recentSignals.map((signal: any) => {
                  const ai = getActionMeta(signal.action);
                  const displayName = getSignalDisplayInstrument(signal);
                  return (
                    <div key={signal.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div className="flex items-center gap-3">
                        <Badge className={cn(ai.className, 'w-12 justify-center text-xs')}>{ai.label}</Badge>
                        <div>
                          <p className="font-medium text-sm">{displayName}</p>
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
