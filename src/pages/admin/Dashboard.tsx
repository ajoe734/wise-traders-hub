import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Users, Radio, TrendingUp, TrendingDown, DollarSign, ArrowUpRight, ArrowDownRight, BarChart3, Loader2 } from 'lucide-react';

const actionLabels: Record<string, { label: string; variant: 'default' | 'destructive' | 'secondary' | 'outline' }> = {
  buy: { label: '買進', variant: 'default' },
  sell: { label: '賣出', variant: 'destructive' },
  add: { label: '加碼', variant: 'secondary' },
  trim: { label: '減碼', variant: 'outline' },
  exit: { label: '平損', variant: 'destructive' },
};

interface MarketIndex {
  IndexName: string;
  ClosingIndex: string;
  Change: string;
  ChangePercent?: string;
  TradeVolume?: string;
}

const AdminDashboard = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const [expert, setExpert] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeSubscribers, setActiveSubscribers] = useState(0);
  const [monthlyRevenue, setMonthlyRevenue] = useState(0);
  const [totalSignals, setTotalSignals] = useState(0);
  const [thisMonthSignals, setThisMonthSignals] = useState(0);
  const [cumulativeReturn, setCumulativeReturn] = useState<number | null>(null);
  const [recentSignals, setRecentSignals] = useState<any[]>([]);
  const [revenueMode, setRevenueMode] = useState<'month' | 'year'>('month');
  const [yearlyRevenue, setYearlyRevenue] = useState(0);
  const [marketIndices, setMarketIndices] = useState<MarketIndex[]>([]);
  const [indicesLoading, setIndicesLoading] = useState(false);

  useEffect(() => { fetchData(); }, [expertSlug]);

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
    
    if (perfRes.data) {
      const perf = perfRes.data as any;
      setCumulativeReturn(perf.cumulative_return ?? null);
    }

    setRecentSignals(recentRes.data || []);

    const mRevenue = (txMonthRes.data || []).reduce((s: number, t: any) => s + (t.amount || 0), 0);
    setMonthlyRevenue(mRevenue);
    const yRevenue = (txYearRes.data || []).reduce((s: number, t: any) => s + (t.amount || 0), 0);
    setYearlyRevenue(yRevenue);

    setLoading(false);

    // Fetch market indices separately (non-blocking)
    fetchMarketIndices();
  };

  const fetchMarketIndices = useCallback(async () => {
    setIndicesLoading(true);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/twse-proxy?endpoint=MI_INDEX`,
        { headers: { apikey: anonKey } }
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          // Filter to key indices: 加權指數, 電子類指數, 金融保險類指數
          const targetNames = ['發行量加權股價指數', '電子類指數', '金融保險類指數', '半導體類指數'];
          const filtered = data.filter((item: any) =>
            targetNames.some(name => item.指數 === name || item.IndexName === name)
          );
          // Normalize fields
          const normalized: MarketIndex[] = filtered.map((item: any) => ({
            IndexName: item.指數 || item.IndexName || '-',
            ClosingIndex: item.收盤指數 || item.ClosingIndex || '-',
            Change: item.漲跌點數 || item.Change || '0',
            ChangePercent: item.漲跌百分比 || item.ChangePercent,
            TradeVolume: item.成交金額 || item.TradeVolume,
          }));
          setMarketIndices(normalized);
        }
      }
    } catch (e) {
      console.error('MI_INDEX fetch error:', e);
    }
    setIndicesLoading(false);
  }, []);

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
      change: `本月 ${thisMonthSignals}`,
      changeType: 'neutral' as const,
      icon: Radio,
    },
    {
      label: '累計報酬率',
      value: cumulativeReturn != null ? `${cumulativeReturn}%` : '-',
      change: '',
      changeType: 'neutral' as const,
      icon: TrendingUp,
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
                <div className="text-2xl font-bold">{stat.value}</div>
                {stat.change && (
                  <div className="text-xs mt-1 text-muted-foreground">{stat.change}</div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Market Index Widget */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              大盤指數
              <span className="text-[10px] text-muted-foreground font-normal">（收盤後更新）</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {indicesLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-2" />
                <span className="text-sm text-muted-foreground">載入指數資料...</span>
              </div>
            ) : marketIndices.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">尚無指數資料（盤中或非交易日）</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {marketIndices.map((idx) => {
                  const change = parseFloat(idx.Change) || 0;
                  const isUp = change > 0;
                  const isDown = change < 0;
                  return (
                    <div key={idx.IndexName} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div>
                        <p className="text-xs text-muted-foreground">{idx.IndexName}</p>
                        <p className="text-lg font-bold">{idx.ClosingIndex}</p>
                      </div>
                      <div className={cn(
                        "flex items-center gap-1 text-sm font-semibold",
                        isUp ? "text-red-500" : isDown ? "text-green-500" : "text-muted-foreground"
                      )}>
                        {isUp && <ArrowUpRight className="h-4 w-4" />}
                        {isDown && <ArrowDownRight className="h-4 w-4" />}
                        <span>{isUp ? '+' : ''}{idx.Change}</span>
                        {idx.ChangePercent && (
                          <span className="text-xs">({isUp ? '+' : ''}{idx.ChangePercent}%)</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

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
                        <Badge variant={ai.variant} className="w-12 justify-center text-xs">{ai.label}</Badge>
                        <div>
                          <p className="font-medium text-sm">{signal.instrument}</p>
                          <p className="text-xs text-muted-foreground">
                            {signal.published_at ? new Date(signal.published_at).toLocaleString('zh-TW') : '-'}
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
