import { useState, useEffect } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { 
  Users, DollarSign, Radio, TrendingUp, ArrowUpRight,
  Activity, Clock, AlertTriangle, CreditCard
} from 'lucide-react';
import { Link } from 'react-router-dom';

const CompanyDashboard = () => {
  const [expertCount, setExpertCount] = useState(0);
  const [subCount, setSubCount] = useState(0);
  const [signalCount, setSignalCount] = useState(0);
  const [planCount, setPlanCount] = useState(0);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    const { count: ec } = await supabase.from('experts').select('*', { count: 'exact', head: true });
    setExpertCount(ec || 0);
    const { count: sc } = await supabase.from('member_subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active');
    setSubCount(sc || 0);
    const { count: pc } = await supabase.from('expert_plans').select('*', { count: 'exact', head: true }).eq('is_active', true);
    setPlanCount(pc || 0);
    const { count: sigc } = await supabase.from('expert_signals').select('*', { count: 'exact', head: true }).eq('status', 'published');
    setSignalCount(sigc || 0);
  };

  const stats = [
    { label: '總分析師數', value: expertCount, icon: Users },
    { label: '活躍訂閱者', value: subCount, icon: Users },
    { label: '已發布訊號', value: signalCount, icon: Radio },
    { label: '總上架方案數', value: planCount, icon: Activity },
  ];

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">公司總覽</h1>
          <p className="text-muted-foreground text-sm mt-1">全平台營運數據一覽</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
              <Button variant="outline" className="h-auto py-4 flex-col gap-2" asChild>
                <Link to="/company/review"><Clock className="h-5 w-5" /><span className="text-xs">內容監管</span></Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
};

export default CompanyDashboard;
