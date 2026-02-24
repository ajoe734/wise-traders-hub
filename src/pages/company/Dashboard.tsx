import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Users, DollarSign, Radio, TrendingUp, ArrowUpRight, ArrowDownRight,
  Eye, Activity, Clock, AlertTriangle
} from 'lucide-react';
import { people, plans, subscriptions, signals } from '@/data/mockData';
import { PersonRole, SubscriptionStatus } from '@/types';
import { Link } from 'react-router-dom';

const CompanyDashboard = () => {
  // Calculate real stats from mock data
  const activeSubs = subscriptions.filter(s => s.status === SubscriptionStatus.ACTIVE).length;
  
  const stats = [
    { label: '總分析師數', value: people.length, change: '+1 本月', changeType: 'up' as const, icon: Users },
    { label: '總活躍訂閱者', value: 156, change: '+12 本月', changeType: 'up' as const, icon: Users },
    { label: '本月平台營收', value: 'NT$458,000', change: '+18%', changeType: 'up' as const, icon: DollarSign },
    { label: '本月總訊號數', value: 34, change: '+8', changeType: 'up' as const, icon: Radio },
    { label: '平均訂閱留存率', value: '87%', change: '+2.1%', changeType: 'up' as const, icon: TrendingUp },
    { label: '待審核內容', value: 2, change: '需處理', changeType: 'neutral' as const, icon: AlertTriangle },
  ];

  // Recent activities
  const recentActivities = [
    { type: 'signal', text: '趙彭博（投顧）發布新訊號：買進 2330 台積電', time: '10 分鐘前', link: '/admin/zhao-pengbo/signals' },
    { type: 'subscribe', text: '新訂閱者 蔡欣怡 訂閱了 黃雅琪 波段佈局', time: '30 分鐘前', link: '/company/subscribers' },
    { type: 'signal', text: '趙彭博（導師）發布修煉派週記 第8週', time: '2 小時前', link: '/admin/zhao-pengbo-mentor' },
    { type: 'cancel', text: '訂閱者 鄭文翰 取消了趙彭博訂閱', time: '3 小時前', link: '/company/subscribers' },
    { type: 'subscribe', text: '新訂閱者 林育德 訂閱了 趙彭博 修煉派週記', time: '5 小時前', link: '/company/subscribers' },
    { type: 'review', text: '趙彭博（投顧）的訊號「減碼 2454 聯發科」已通過審核', time: '昨天 14:20', link: '/company/review' },
  ];

  // Analyst performance summary
  const analystPerformance = people.map((person) => {
    const personPlans = plans.filter(p => p.personId === person.id);
    const personActiveSubs = subscriptions.filter(
      s => personPlans.some(p => p.id === s.planId) && s.status === SubscriptionStatus.ACTIVE
    ).length;
    const mockMonthlyRevenue = personActiveSubs * (person.role === PersonRole.ADVISOR ? 3980 : 1980);
    return {
      person,
      activeSubs: personActiveSubs || Math.floor(Math.random() * 20 + 5),
      monthlyRevenue: mockMonthlyRevenue || Math.floor(Math.random() * 80000 + 20000),
      signalsThisMonth: Math.floor(Math.random() * 12 + 2),
    };
  });

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">公司總覽</h1>
          <p className="text-muted-foreground text-sm mt-1">全平台營運數據一覽</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {stats.map((stat) => (
            <Card key={stat.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">{stat.label}</span>
                  <stat.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-2xl font-bold">{stat.value}</div>
                <div className={`text-xs mt-1 flex items-center gap-1 ${
                  stat.changeType === 'up' ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'
                }`}>
                  {stat.changeType === 'up' && <ArrowUpRight className="h-3 w-3" />}
                  {stat.change}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Activity */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">最近動態</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {recentActivities.map((activity, i) => (
                  <Link
                    key={i}
                    to={activity.link}
                    className="flex items-start gap-3 py-2 border-b last:border-0 hover:bg-muted/50 -mx-2 px-2 rounded transition-colors"
                  >
                    <div className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${
                      activity.type === 'signal' ? 'bg-primary' :
                      activity.type === 'subscribe' ? 'bg-green-500' :
                      activity.type === 'cancel' ? 'bg-destructive' :
                      'bg-muted-foreground'
                    }`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug">{activity.text}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{activity.time}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Analyst Rankings */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">分析師營收排名</CardTitle>
                <Link to="/company/analysts" className="text-xs text-primary hover:underline">查看全部</Link>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {analystPerformance
                  .sort((a, b) => b.monthlyRevenue - a.monthlyRevenue)
                  .map(({ person, activeSubs, monthlyRevenue, signalsThisMonth }, i) => (
                  <div key={person.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                      <img
                        src={person.avatarUrl || '/placeholder.svg'}
                        alt={person.name}
                        className="h-8 w-8 rounded-full object-cover"
                      />
                      <div>
                        <p className="font-medium text-sm">{person.name}</p>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                            {person.role === PersonRole.ADVISOR ? '投顧分析師' : '實戰導師'}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">{activeSubs} 訂閱</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">NT${monthlyRevenue.toLocaleString()}</p>
                      <p className="text-[10px] text-muted-foreground">{signalsThisMonth} 訊號/月</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">快捷操作</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Button variant="outline" className="h-auto py-4 flex-col gap-2" asChild>
                <Link to="/company/analysts">
                  <Users className="h-5 w-5" />
                  <span className="text-xs">管理分析師</span>
                </Link>
              </Button>
              <Button variant="outline" className="h-auto py-4 flex-col gap-2" asChild>
                <Link to="/company/subscribers">
                  <Users className="h-5 w-5" />
                  <span className="text-xs">訂閱者管理</span>
                </Link>
              </Button>
              <Button variant="outline" className="h-auto py-4 flex-col gap-2" asChild>
                <Link to="/company/revenue">
                  <DollarSign className="h-5 w-5" />
                  <span className="text-xs">營收報表</span>
                </Link>
              </Button>
              <Button variant="outline" className="h-auto py-4 flex-col gap-2" asChild>
                <Link to="/company/review">
                  <Clock className="h-5 w-5" />
                  <span className="text-xs">內容審核</span>
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
};

export default CompanyDashboard;
