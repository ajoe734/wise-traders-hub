import { useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getPersonBySlug, plans, subscriptions, signals } from '@/data/mockData';
import { PersonRole, SubscriptionStatus } from '@/types';
import { cn } from '@/lib/utils';
import { Users, Radio, TrendingUp, DollarSign, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { format } from 'date-fns';

const AdminDashboard = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const expert = expertSlug ? getPersonBySlug(expertSlug) : undefined;

  if (!expert) return <AdminLayout><div /></AdminLayout>;

  const isAdvisor = expert.role === PersonRole.ADVISOR;

  // Mock stats
  const expertPlans = plans.filter(p => p.personId === expert.id);
  const activeSubscribers = subscriptions.filter(s => 
    expertPlans.some(p => p.id === s.planId) && s.status === SubscriptionStatus.ACTIVE
  ).length;
  
  // Mock additional stats
  const totalRevenue = 128500;
  const monthlyRevenue = 32800;
  const totalSignals = 47;
  const thisMonthSignals = 12;

  const stats = [
    {
      label: '活躍訂閱者',
      value: activeSubscribers || 23,
    change: '+3',
    changeType: 'up',
      icon: Users,
    },
    {
      label: '本月營收',
      value: `NT$${monthlyRevenue.toLocaleString()}`,
    change: '+12%',
    changeType: 'up',
      icon: DollarSign,
    },
    {
      label: '累計發布訊號',
      value: totalSignals,
    change: `本月 ${thisMonthSignals}`,
    changeType: 'neutral',
      icon: Radio,
    },
    {
      label: '累計報酬率',
      value: '680%',
    change: '+2.3% 本月',
    changeType: 'up',
      icon: TrendingUp,
    },
  ];

  // Recent signals (mock)
  const recentSignals = [
    { id: '1', instrument: '2330 台積電', action: '買進', time: '2025-02-20 09:15', status: '已發布' },
    { id: '2', instrument: '2454 聯發科', action: '賣出', time: '2025-02-19 13:20', status: '已發布' },
    { id: '3', instrument: '3661 世芯-KY', action: '加碼', time: '2025-02-18 10:05', status: '已發布' },
    { id: '4', instrument: '2603 長榮', action: '減碼', time: '2025-02-17 11:30', status: '已發布' },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Page Title */}
        <div>
          <h1 className="text-2xl font-bold">後台總覽</h1>
          <p className="text-muted-foreground text-sm mt-1">
            歡迎回來，{expert.name}
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <Card key={stat.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">{stat.label}</span>
                  <stat.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-2xl font-bold">{stat.value}</div>
                <div className={cn(
                  "text-xs mt-1 flex items-center gap-1",
                  stat.changeType === 'up' && "text-green-600 dark:text-green-400",
                  stat.changeType === 'down' && "text-red-600 dark:text-red-400",
                  stat.changeType === 'neutral' && "text-muted-foreground"
                )}>
                  {stat.changeType === 'up' && <ArrowUpRight className="h-3 w-3" />}
                  {stat.changeType === 'down' && <ArrowDownRight className="h-3 w-3" />}
                  {stat.change}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Recent Signals */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">最近發布的訊號</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentSignals.map((signal) => (
                <div key={signal.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex items-center gap-3">
                    <Badge variant={
                      signal.action === '買進' ? 'default' : 
                      signal.action === '賣出' ? 'destructive' : 'secondary'
                    } className="w-12 justify-center text-xs">
                      {signal.action}
                    </Badge>
                    <div>
                      <p className="font-medium text-sm">{signal.instrument}</p>
                      <p className="text-xs text-muted-foreground">{signal.time}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">{signal.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Active Plans */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">上架方案</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {expertPlans.map((plan) => (
                <div key={plan.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium text-sm">{plan.name}</p>
                    <p className="text-xs text-muted-foreground">
                      NT${plan.priceMonthly.toLocaleString()}/月
                    </p>
                  </div>
                  <Badge variant={plan.isActive ? 'secondary' : 'outline'}>
                    {plan.isActive ? '上架中' : '已下架'}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default AdminDashboard;
