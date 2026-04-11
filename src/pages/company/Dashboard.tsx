import { useState, useEffect } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { 
  DollarSign, Radio, CreditCard, UserPlus,
  Repeat
} from 'lucide-react';
import { Link } from 'react-router-dom';

const CompanyDashboard = () => {
  const [expertCount, setExpertCount] = useState(0);
  const [newSubCount, setNewSubCount] = useState(0);
  const [signalCount, setSignalCount] = useState(0);
  const [refundCount, setRefundCount] = useState(0);
  const [mrr, setMrr] = useState(0);
  const [monthlyRevenue, setMonthlyRevenue] = useState(0);

  useEffect(() => { fetchStats(); }, []);

  const fetchStats = async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [ecRes, newSubRes, sigRes, subsRes, txRes, refundRes] = await Promise.all([
      supabase.from('experts').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('member_subscriptions').select('*', { count: 'exact', head: true }).gte('started_at', monthStart),
      supabase.from('expert_signals').select('*', { count: 'exact', head: true }).eq('status', 'published'),
      supabase.from('member_subscriptions').select('*, expert_plans(price_monthly)').eq('status', 'active').eq('auto_renew', true),
      supabase.from('payment_transactions').select('amount').eq('status', 'paid').gte('paid_at', monthStart),
      supabase.from('payment_transactions').select('*', { count: 'exact', head: true }).eq('status', 'refunded').gte('created_at', monthStart),
    ]);

    setExpertCount(ecRes.count || 0);
    setNewSubCount(newSubRes.count || 0);
    setRefundCount(refundRes.count || 0);
    setSignalCount(sigRes.count || 0);
    setMrr((subsRes.data || []).reduce((s, sub) => s + (sub.expert_plans?.price_monthly || 0), 0));
    setMonthlyRevenue((txRes.data || []).reduce((s, tx) => s + (tx.amount || 0), 0));
  };

  const stats = [
    { label: '總分析師數', value: expertCount, icon: Users },
    { label: '本月新增訂閱', value: newSubCount, icon: UserPlus },
    { label: '已發布訊號', value: signalCount, icon: Radio },
    { label: '本月退款數', value: refundCount, icon: CreditCard },
    { label: 'MRR', value: `NT$${mrr.toLocaleString()}`, icon: Repeat },
    { label: '本月營收', value: `NT$${monthlyRevenue.toLocaleString()}`, icon: DollarSign },
  ];

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">公司總覽</h1>
          <p className="text-muted-foreground text-sm mt-1">海洋福星生物科技股份有限公司（統編：83479669）・全平台營運數據一覽</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {stats.map((stat) => (
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
            </div>
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
};

export default CompanyDashboard;
