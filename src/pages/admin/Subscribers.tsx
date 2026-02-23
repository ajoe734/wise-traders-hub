import { useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { getPersonBySlug } from '@/data/mockData';
import { cn } from '@/lib/utils';
import { Users, TrendingUp, UserPlus, UserMinus, Search } from 'lucide-react';
import { useState } from 'react';

const AdminSubscribers = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const expert = expertSlug ? getPersonBySlug(expertSlug) : undefined;
  const [searchQuery, setSearchQuery] = useState('');

  if (!expert) return <AdminLayout><div /></AdminLayout>;

  // Mock subscriber stats
  const stats = [
    { label: '總訂閱人數', value: 23, icon: Users },
    { label: '本月新增', value: 5, icon: UserPlus },
    { label: '本月流失', value: 1, icon: UserMinus },
    { label: '續訂率', value: '87%', icon: TrendingUp },
  ];

  // Mock subscribers
  const mockSubscribers = [
    { id: '1', name: '王小明', email: 'wang@example.com', plan: '分析師即時策略訂閱', startDate: '2024-11-15', endDate: '2025-11-15', status: 'active', renewMode: '自動續訂' },
    { id: '2', name: '李小華', email: 'li@example.com', plan: '分析師策略＋持股健檢', startDate: '2024-12-01', endDate: '2025-12-01', status: 'active', renewMode: '自動續訂' },
    { id: '3', name: '張志豪', email: 'chang@example.com', plan: '分析師即時策略訂閱', startDate: '2025-01-10', endDate: '2026-01-10', status: 'active', renewMode: '手動續訂' },
    { id: '4', name: '陳美惠', email: 'chen@example.com', plan: '分析師即時策略訂閱', startDate: '2024-08-01', endDate: '2025-02-01', status: 'expired', renewMode: '手動續訂' },
    { id: '5', name: '劉建安', email: 'liu@example.com', plan: '分析師策略＋持股健檢', startDate: '2025-02-01', endDate: '2026-02-01', status: 'active', renewMode: '自動續訂' },
  ];

  const filteredSubscribers = mockSubscribers.filter(s =>
    s.name.includes(searchQuery) || s.email.includes(searchQuery)
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">訂閱者管理</h1>
          <p className="text-muted-foreground text-sm mt-1">查看與管理您的訂閱者</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜尋姓名或 Email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Subscribers Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">姓名</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">Email</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">方案</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">訂閱日</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">到期日</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">續訂</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSubscribers.map((sub) => (
                    <tr key={sub.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="p-3 text-sm font-medium">{sub.name}</td>
                      <td className="p-3 text-sm text-muted-foreground">{sub.email}</td>
                      <td className="p-3 text-sm">{sub.plan}</td>
                      <td className="p-3 text-sm text-muted-foreground">{sub.startDate}</td>
                      <td className="p-3 text-sm text-muted-foreground">{sub.endDate}</td>
                      <td className="p-3 text-sm">{sub.renewMode}</td>
                      <td className="p-3">
                        <Badge variant={sub.status === 'active' ? 'secondary' : 'outline'} className="text-xs">
                          {sub.status === 'active' ? '有效' : '已到期'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default AdminSubscribers;
