import { useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { plans, subscriptions, people } from '@/data/mockData';
import { SubscriptionStatus } from '@/types';
import { Search, Users, UserCheck, UserX, Mail } from 'lucide-react';
import { format } from 'date-fns';

// Mock subscriber data
const mockSubscribers = [
  { id: 'sub-1', name: '王小明', email: 'demo@example.com', joinDate: '2024-01-15', planNames: ['趙彭博 即時策略訂閱', '趙彭博 修煉派週記'], status: 'active', totalSpent: 15800 },
  { id: 'sub-2', name: '李大華', email: 'li@example.com', joinDate: '2024-03-20', planNames: ['趙彭博 即時策略訂閱'], status: 'active', totalSpent: 9900 },
  { id: 'sub-3', name: '張美麗', email: 'zhang@example.com', joinDate: '2024-05-10', planNames: ['趙彭博 修煉派週記'], status: 'active', totalSpent: 5900 },
  { id: 'sub-4', name: '陳志強', email: 'chen.zq@example.com', joinDate: '2024-02-28', planNames: ['陳建宏 趨勢波段'], status: 'active', totalSpent: 11800 },
  { id: 'sub-5', name: '黃雅婷', email: 'huang.yt@example.com', joinDate: '2024-06-01', planNames: ['林美玲 價值存股'], status: 'active', totalSpent: 7900 },
  { id: 'sub-6', name: '劉建國', email: 'liu@example.com', joinDate: '2024-04-12', planNames: ['趙彭博 即時策略訂閱'], status: 'expired', totalSpent: 3960 },
  { id: 'sub-7', name: '吳佳蓉', email: 'wu.jr@example.com', joinDate: '2024-07-08', planNames: ['吳志明 短線動能'], status: 'active', totalSpent: 5900 },
  { id: 'sub-8', name: '鄭文翰', email: 'zheng@example.com', joinDate: '2024-08-15', planNames: ['趙彭博 即時策略訂閱', '趙彭博 修煉派週記'], status: 'canceled', totalSpent: 15800 },
  { id: 'sub-9', name: '蔡欣怡', email: 'tsai@example.com', joinDate: '2024-09-01', planNames: ['黃雅琪 波段佈局'], status: 'active', totalSpent: 3960 },
  { id: 'sub-10', name: '林育德', email: 'lin.yd@example.com', joinDate: '2024-10-20', planNames: ['趙彭博 修煉派週記'], status: 'active', totalSpent: 1980 },
];

const CompanySubscribers = () => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = mockSubscribers.filter((s) => {
    const matchSearch = !search || 
      s.name.includes(search) || 
      s.email.includes(search) ||
      s.planNames.some(p => p.includes(search));
    const matchStatus = statusFilter === 'all' || s.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const activeCount = mockSubscribers.filter(s => s.status === 'active').length;
  const expiredCount = mockSubscribers.filter(s => s.status === 'expired').length;
  const canceledCount = mockSubscribers.filter(s => s.status === 'canceled').length;

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">訂閱者管理</h1>
          <p className="text-muted-foreground text-sm mt-1">查看與管理所有平台訂閱者</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold">{mockSubscribers.length}</div>
                <div className="text-xs text-muted-foreground">總訂閱者</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <UserCheck className="h-5 w-5 text-green-500" />
              <div>
                <div className="text-2xl font-bold">{activeCount}</div>
                <div className="text-xs text-muted-foreground">活躍中</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <UserX className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold">{expiredCount}</div>
                <div className="text-xs text-muted-foreground">已到期</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <UserX className="h-5 w-5 text-destructive" />
              <div>
                <div className="text-2xl font-bold">{canceledCount}</div>
                <div className="text-xs text-muted-foreground">已取消</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜尋姓名、Email 或方案..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center bg-muted rounded-lg p-1">
            {[
              { key: 'all', label: '全部' },
              { key: 'active', label: '活躍' },
              { key: 'expired', label: '到期' },
              { key: 'canceled', label: '取消' },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                  statusFilter === f.key
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="p-4">訂閱者</th>
                  <th className="p-4">訂閱方案</th>
                  <th className="p-4">加入日期</th>
                  <th className="p-4">累計消費</th>
                  <th className="p-4">狀態</th>
                  <th className="p-4">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((sub) => (
                  <tr key={sub.id} className="border-b last:border-0">
                    <td className="p-4">
                      <div>
                        <p className="font-medium text-sm">{sub.name}</p>
                        <p className="text-xs text-muted-foreground">{sub.email}</p>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1">
                        {sub.planNames.map((name) => (
                          <Badge key={name} variant="outline" className="text-[10px]">
                            {name}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">{sub.joinDate}</td>
                    <td className="p-4 text-sm font-medium">NT${sub.totalSpent.toLocaleString()}</td>
                    <td className="p-4">
                      <Badge
                        variant={sub.status === 'active' ? 'default' : sub.status === 'expired' ? 'outline' : 'destructive'}
                        className="text-xs"
                      >
                        {sub.status === 'active' ? '活躍' : sub.status === 'expired' ? '已到期' : '已取消'}
                      </Badge>
                    </td>
                    <td className="p-4">
                      <Button variant="ghost" size="sm" className="h-7 text-xs">
                        <Mail className="h-3 w-3 mr-1" />
                        聯繫
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="p-8 text-center text-muted-foreground text-sm">
                找不到符合條件的訂閱者
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
};

export default CompanySubscribers;
