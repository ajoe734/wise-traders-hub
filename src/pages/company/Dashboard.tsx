import { SEO } from '@/components/SEO';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import {
  Users, DollarSign, Radio, TrendingDown, UserPlus,
  Repeat, Megaphone, CreditCard, Stethoscope
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { taipeiMonthStartIso } from '@/checkup/utils/formatTaipeiDate';

const CompanyDashboard = () => {
  const { data: stats } = useQuery({
    queryKey: ['company', 'dashboard'],
    staleTime: 30_000,
    queryFn: async () => {
      const now = new Date();
      // P4 D-G/H：以 Asia/Taipei 月初為基準，避免伺服器時區（UTC）把月初算成上月最後一天。
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

  const s = stats || {
    expertCount: 0, newSubCount: 0, signalCount: 0, cancelCount: 0,
    mrr: 0, expertMrr: 0, checkupMrr: 0, checkupActiveCount: 0, monthlyRevenue: 0,
  };

  const items = [
    { label: '總分析師數', value: s.expertCount, icon: Users },
    { label: '本月新增訂閱（含健檢）', value: s.newSubCount, icon: UserPlus },
    { label: '本月取消訂閱（含健檢）', value: s.cancelCount, icon: TrendingDown },
    { label: '已發布訊號', value: s.signalCount, icon: Radio },
    { label: 'MRR（合計）', value: `NT$${s.mrr.toLocaleString()}`, icon: Repeat },
    { label: '└ 訂閱方案 MRR', value: `NT$${s.expertMrr.toLocaleString()}`, icon: Repeat },
    { label: '└ 健檢方案 MRR', value: `NT$${s.checkupMrr.toLocaleString()}`, icon: Stethoscope },
    { label: '健檢活躍訂閱', value: s.checkupActiveCount, icon: Stethoscope },
    { label: '本月營收', value: `NT$${s.monthlyRevenue.toLocaleString()}`, icon: DollarSign },
  ];

  return (
    <CompanyLayout>
      <SEO title={'公司後台首頁 | legendflow'} description={'平台營運總覽。'} path={'/company'} noindex />
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">公司總覽</h1>
          <p className="text-muted-foreground text-sm mt-1">海洋福星生物科技股份有限公司（統編：83479669）・全平台營運數據一覽</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((stat) => (
            <Card key={stat.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">{stat.label}</span>
                  <stat.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-2xl font-bold">{stat.value}</div>
              </CardContent>
            </Card>
          ))}
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
