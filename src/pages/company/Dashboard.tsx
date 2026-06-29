import { SEO } from '@/components/SEO';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import {
  Users, DollarSign, Radio, TrendingDown, UserPlus,
  Repeat, Megaphone, CreditCard, Stethoscope,
  ArrowUpRight, ArrowDownRight, Minus, AlertCircle, Clock, Activity,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { taipeiMonthStartIso } from '@/checkup/utils/formatTaipeiDate';
import { lazy, Suspense, useMemo } from 'react';

const Sparkline = lazy(() => import('@/pages/_companyTraffic/Charts').then(m => ({ default: m.Sparkline })));

const MS_DAY = 86_400_000;
const MS_WEEK = MS_DAY * 7;

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * MS_DAY).toISOString();
}
function bucketByDay(rows: Array<{ created_at?: string | null }>, days = 14): number[] {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const startMs = start.getTime() - (days - 1) * MS_DAY;
  const buckets = new Array(days).fill(0);
  for (const r of rows) {
    if (!r?.created_at) continue;
    const t = new Date(r.created_at).getTime();
    const idx = Math.floor((t - startMs) / MS_DAY);
    if (idx >= 0 && idx < days) buckets[idx] += 1;
  }
  return buckets;
}

function pctDelta(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null;
  return ((curr - prev) / prev) * 100;
}

function DeltaBadge({ delta, invert = false }: { delta: number | null; invert?: boolean }) {
  if (delta === null) {
    return <span className="text-[11px] text-muted-foreground">無對比</span>;
  }
  if (Math.abs(delta) < 0.05) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
        <Minus className="h-3 w-3" /> 0%
      </span>
    );
  }
  const positive = delta > 0;
  // 對營收/新訂閱：正成長為佳；對 churn/取消：invert=true，正成長為差
  const good = invert ? !positive : positive;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${good ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

const CompanyDashboard = () => {
  // ── 月度核心 KPI ─────────────────────────────────────────
  const { data: stats } = useQuery({
    queryKey: ['company', 'dashboard', 'v2'],
    staleTime: 30_000,
    queryFn: async () => {
      const now = new Date();
      const monthStart = taipeiMonthStartIso(now);

      const [ecRes, newSubRes, newCheckupSubRes, sigRes, subsRes, cSubsRes, txRes, churnRes, cChurnRes] = await Promise.all([
        supabase.from('experts').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('member_subscriptions').select('*', { count: 'exact', head: true }).gte('created_at', monthStart),
        supabase.from('checkup_subscriptions').select('*', { count: 'exact', head: true }).gte('created_at', monthStart),
        supabase.from('expert_signals').select('*', { count: 'exact', head: true }).eq('status', 'published'),
        supabase.from('member_subscriptions').select('*, expert_plans(price_monthly)').eq('status', 'active').gt('expires_at', now.toISOString()),
        supabase.from('checkup_subscriptions').select('*, checkup_plans(price_monthly, price_yearly), billing_cycle').eq('status', 'active').gt('expires_at', now.toISOString()),
        supabase.from('payment_transactions').select('amount').eq('status', 'paid').gte('paid_at', monthStart),
        supabase.from('member_subscriptions').select('*', { count: 'exact', head: true }).in('status', ['canceled', 'expired']).gte('canceled_at', monthStart),
        supabase.from('checkup_subscriptions').select('*', { count: 'exact', head: true }).in('status', ['canceled', 'expired']).gte('canceled_at', monthStart),
      ]);

      const eMrr = (subsRes.data || []).reduce((s, sub: any) => s + (sub.expert_plans?.price_monthly || 0), 0);
      const cMrr = (cSubsRes.data || []).reduce((s, sub: any) => {
        const p = sub.checkup_plans;
        if (!p) return s;
        if (sub.billing_cycle === 'yearly') return s + Math.round((p.price_yearly || 0) / 12);
        return s + (p.price_monthly || 0);
      }, 0);

      return {
        expertCount: ecRes.count || 0,
        newSubCount: (newSubRes.count || 0) + (newCheckupSubRes.count || 0),
        signalCount: sigRes.count || 0,
        expertMrr: eMrr,
        checkupMrr: cMrr,
        mrr: eMrr + cMrr,
        checkupActiveCount: (cSubsRes.data || []).length,
        monthlyRevenue: (txRes.data || []).reduce((s, tx: any) => s + (tx.amount || 0), 0),
        cancelCount: (churnRes.count || 0) + (cChurnRes.count || 0),
      };
    },
  });

  // ── WoW（本週 vs 上週）+ 14 天趨勢 ────────────────────────
  const { data: wow } = useQuery({
    queryKey: ['company', 'dashboard', 'wow-v2'],
    staleTime: 60_000,
    queryFn: async () => {
      const now = Date.now();
      const thisWeekStart = new Date(now - MS_WEEK).toISOString();
      const lastWeekStart = new Date(now - MS_WEEK * 2).toISOString();
      const last14Start = new Date(now - MS_DAY * 14).toISOString();

      const [
        thisNewExpert, lastNewExpert, thisNewCheckup, lastNewCheckup,
        thisChurnExpert, lastChurnExpert, thisChurnCheckup, lastChurnCheckup,
        thisRev, lastRev,
        last14Expert, last14Checkup,
      ] = await Promise.all([
        supabase.from('member_subscriptions').select('*', { count: 'exact', head: true }).gte('created_at', thisWeekStart),
        supabase.from('member_subscriptions').select('*', { count: 'exact', head: true }).gte('created_at', lastWeekStart).lt('created_at', thisWeekStart),
        supabase.from('checkup_subscriptions').select('*', { count: 'exact', head: true }).gte('created_at', thisWeekStart),
        supabase.from('checkup_subscriptions').select('*', { count: 'exact', head: true }).gte('created_at', lastWeekStart).lt('created_at', thisWeekStart),
        supabase.from('member_subscriptions').select('*', { count: 'exact', head: true }).in('status', ['canceled', 'expired']).gte('canceled_at', thisWeekStart),
        supabase.from('member_subscriptions').select('*', { count: 'exact', head: true }).in('status', ['canceled', 'expired']).gte('canceled_at', lastWeekStart).lt('canceled_at', thisWeekStart),
        supabase.from('checkup_subscriptions').select('*', { count: 'exact', head: true }).in('status', ['canceled', 'expired']).gte('canceled_at', thisWeekStart),
        supabase.from('checkup_subscriptions').select('*', { count: 'exact', head: true }).in('status', ['canceled', 'expired']).gte('canceled_at', lastWeekStart).lt('canceled_at', thisWeekStart),
        supabase.from('payment_transactions').select('amount').eq('status', 'paid').gte('paid_at', thisWeekStart),
        supabase.from('payment_transactions').select('amount').eq('status', 'paid').gte('paid_at', lastWeekStart).lt('paid_at', thisWeekStart),
        supabase.from('member_subscriptions').select('created_at').gte('created_at', last14Start),
        supabase.from('checkup_subscriptions').select('created_at').gte('created_at', last14Start),
      ]);

      const sumAmount = (rows: any[] | null) => (rows || []).reduce((s, r) => s + (r.amount || 0), 0);
      const thisNewSubs = (thisNewExpert.count || 0) + (thisNewCheckup.count || 0);
      const lastNewSubs = (lastNewExpert.count || 0) + (lastNewCheckup.count || 0);
      const thisChurn = (thisChurnExpert.count || 0) + (thisChurnCheckup.count || 0);
      const lastChurn = (lastChurnExpert.count || 0) + (lastChurnCheckup.count || 0);
      const thisRevenue = sumAmount(thisRev.data as any[]);
      const lastRevenue = sumAmount(lastRev.data as any[]);

      const allNew = [
        ...((last14Expert.data as any[]) || []),
        ...((last14Checkup.data as any[]) || []),
      ];
      const sparkline = bucketByDay(allNew, 14);

      return {
        newSubDelta: pctDelta(thisNewSubs, lastNewSubs),
        churnDelta: pctDelta(thisChurn, lastChurn),
        revenueDelta: pctDelta(thisRevenue, lastRevenue),
        sparkline,
        thisNewSubs, lastNewSubs,
        thisChurn, lastChurn,
        thisRevenue, lastRevenue,
      };
    },
  });

  // ── 24h 即時列 ──────────────────────────────────────────
  const { data: realtime } = useQuery({
    queryKey: ['company', 'dashboard', 'realtime-24h'],
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const since = isoDaysAgo(1);
      const [newE, newC, churnE, churnC, rev] = await Promise.all([
        supabase.from('member_subscriptions').select('*', { count: 'exact', head: true }).gte('created_at', since),
        supabase.from('checkup_subscriptions').select('*', { count: 'exact', head: true }).gte('created_at', since),
        supabase.from('member_subscriptions').select('*', { count: 'exact', head: true }).in('status', ['canceled', 'expired']).gte('canceled_at', since),
        supabase.from('checkup_subscriptions').select('*', { count: 'exact', head: true }).in('status', ['canceled', 'expired']).gte('canceled_at', since),
        supabase.from('payment_transactions').select('amount').eq('status', 'paid').gte('paid_at', since),
      ]);
      return {
        newSubs: (newE.count || 0) + (newC.count || 0),
        churn: (churnE.count || 0) + (churnC.count || 0),
        revenue: ((rev.data as any[]) || []).reduce((s, r) => s + (r.amount || 0), 0),
      };
    },
  });

  // ── 待辦徽章 ────────────────────────────────────────────
  const { data: pending } = useQuery({
    queryKey: ['company', 'dashboard', 'pending'],
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const [remitPending, remitAwaiting, planPending] = await Promise.all([
        supabase.from('remittance_orders').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('remittance_orders').select('*', { count: 'exact', head: true }).eq('status', 'awaiting_info'),
        supabase.from('expert_plans').select('*', { count: 'exact', head: true }).eq('review_status', 'pending'),
      ]);
      return {
        remitPending: remitPending.count || 0,
        remitAwaiting: remitAwaiting.count || 0,
        planPending: planPending.count || 0,
      };
    },
  });

  const s = stats || {
    expertCount: 0, newSubCount: 0, signalCount: 0, cancelCount: 0,
    mrr: 0, expertMrr: 0, checkupMrr: 0, checkupActiveCount: 0, monthlyRevenue: 0,
  };

  const items = useMemo(() => ([
    { label: '總分析師數', value: s.expertCount, icon: Users, delta: null as number | null, invert: false },
    { label: '本月新增訂閱（含健檢）', value: s.newSubCount, icon: UserPlus, delta: wow?.newSubDelta ?? null, invert: false, sub: wow ? `本週 ${wow.thisNewSubs} ・ 上週 ${wow.lastNewSubs}` : undefined },
    { label: '本月取消訂閱（含健檢）', value: s.cancelCount, icon: TrendingDown, delta: wow?.churnDelta ?? null, invert: true, sub: wow ? `本週 ${wow.thisChurn} ・ 上週 ${wow.lastChurn}` : undefined },
    { label: '已發布訊號', value: s.signalCount, icon: Radio, delta: null, invert: false },
    { label: 'MRR（合計）', value: `NT$${s.mrr.toLocaleString()}`, icon: Repeat, delta: null, invert: false },
    { label: '└ 訂閱方案 MRR', value: `NT$${s.expertMrr.toLocaleString()}`, icon: Repeat, delta: null, invert: false },
    { label: '└ 健檢方案 MRR', value: `NT$${s.checkupMrr.toLocaleString()}`, icon: Stethoscope, delta: null, invert: false },
    { label: '健檢活躍訂閱', value: s.checkupActiveCount, icon: Stethoscope, delta: null, invert: false },
    { label: '本月營收', value: `NT$${s.monthlyRevenue.toLocaleString()}`, icon: DollarSign, delta: wow?.revenueDelta ?? null, invert: false, sub: wow ? `本週 NT$${wow.thisRevenue.toLocaleString()} ・ 上週 NT$${wow.lastRevenue.toLocaleString()}` : undefined },
  ]), [s, wow]);

  const totalPending = (pending?.remitPending || 0) + (pending?.remitAwaiting || 0) + (pending?.planPending || 0);

  return (
    <CompanyLayout>
      <SEO title={'公司後台首頁 | legendflow'} description={'平台營運總覽。'} path={'/company'} noindex />
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">公司總覽</h1>
            <p className="text-muted-foreground text-sm mt-1">海洋福星生物科技股份有限公司（統編：83479669）・全平台營運數據一覽</p>
          </div>
          {totalPending > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="h-3.5 w-3.5" /> 待處理 {totalPending} 件
            </Badge>
          )}
        </div>

        {/* 24h 即時列 */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Activity className="h-4 w-4 text-emerald-500" />
                <span>過去 24 小時即時</span>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <span className="text-[11px] text-muted-foreground">每 30 秒更新</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="text-[11px] text-muted-foreground">新訂閱</div>
                <div className="text-xl font-bold">{realtime?.newSubs ?? '—'}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">取消</div>
                <div className="text-xl font-bold">{realtime?.churn ?? '—'}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">營收</div>
                <div className="text-xl font-bold">NT${(realtime?.revenue ?? 0).toLocaleString()}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 待辦徽章 */}
        {pending && totalPending > 0 && (
          <Card className="border-amber-200/60 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3 text-sm font-medium">
                <Clock className="h-4 w-4 text-amber-600" />
                <span>待處理事項</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {pending.remitPending > 0 && (
                  <Button asChild size="sm" variant="outline">
                    <Link to="/company/remittance">待對帳匯款 <Badge variant="destructive" className="ml-2">{pending.remitPending}</Badge></Link>
                  </Button>
                )}
                {pending.remitAwaiting > 0 && (
                  <Button asChild size="sm" variant="outline">
                    <Link to="/company/remittance">等待補件 <Badge variant="secondary" className="ml-2">{pending.remitAwaiting}</Badge></Link>
                  </Button>
                )}
                {pending.planPending > 0 && (
                  <Button asChild size="sm" variant="outline">
                    <Link to="/company/analysts">待審核方案 <Badge variant="secondary" className="ml-2">{pending.planPending}</Badge></Link>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* KPI 卡（含 WoW + sparkline） */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((stat) => {
            const showSpark = stat.label.startsWith('本月新增訂閱') && wow?.sparkline?.length;
            return (
              <Card key={stat.label}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">{stat.label}</span>
                    <stat.icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-2xl font-bold">{stat.value}</div>
                    <DeltaBadge delta={stat.delta} invert={stat.invert} />
                  </div>
                  {stat.sub && <div className="mt-1 text-[11px] text-muted-foreground">{stat.sub}</div>}
                  {showSpark && (
                    <div className="mt-2">
                      <Suspense fallback={<div style={{ height: 32 }} />}>
                        <Sparkline data={wow!.sparkline} height={32} />
                      </Suspense>
                      <div className="text-[10px] text-muted-foreground mt-0.5">最近 14 天每日新訂閱</div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">快捷操作</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <Button variant="outline" className="h-auto py-4 flex-col gap-2" asChild>
                <Link to="/company/analysts"><Users className="h-5 w-5" /><span className="text-xs">分析師管理</span></Link>
              </Button>
              <Button variant="outline" className="h-auto py-4 flex-col gap-2" asChild>
                <Link to="/company/subscribers"><Users className="h-5 w-5" /><span className="text-xs">訂閱者管理</span></Link>
              </Button>
              <Button variant="outline" className="h-auto py-4 flex-col gap-2" asChild>
                <Link to="/company/revenue"><DollarSign className="h-5 w-5" /><span className="text-xs">營收報表</span></Link>
              </Button>
              <Button variant="outline" className="h-auto py-4 flex-col gap-2" asChild>
                <Link to="/company/payments"><CreditCard className="h-5 w-5" /><span className="text-xs">金流管理</span></Link>
              </Button>
              <Button variant="outline" className="h-auto py-4 flex-col gap-2" asChild>
                <Link to="/company/announcements"><Megaphone className="h-5 w-5" /><span className="text-xs">公告管理</span></Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
};

export default CompanyDashboard;
