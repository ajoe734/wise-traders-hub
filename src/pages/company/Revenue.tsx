import { useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { people, plans } from '@/data/mockData';
import { PersonRole } from '@/types';
import { DollarSign, TrendingUp, ArrowUpRight, Users, Download } from 'lucide-react';

// Enhanced revenue data per analyst
const mockRevenue = [
  { name: '趙彭博', slug: 'zhao-pengbo', role: '投顧分析師', monthly: 128500, yearly: 1542000, subs: 23, growth: 12, plans: ['即時策略訂閱 L1', '即時策略+健檢 L2'] },
  { name: '趙彭博', slug: 'zhao-pengbo-mentor', role: '實戰導師', monthly: 45800, yearly: 549600, subs: 15, growth: 8, plans: ['修煉派週記'] },
  { name: '陳建宏', slug: 'chen-advisor', role: '投顧分析師', monthly: 95200, yearly: 1142400, subs: 18, growth: 15, plans: ['趨勢波段訂閱'] },
  { name: '林美玲', slug: 'lin-advisor', role: '投顧分析師', monthly: 71400, yearly: 856800, subs: 14, growth: 5, plans: ['價值存股訂閱'] },
  { name: '吳志明', slug: 'wu-mentor', role: '實戰導師', monthly: 35600, yearly: 427200, subs: 12, growth: -2, plans: ['短線教學週記'] },
  { name: '黃雅琪', slug: 'huang-mentor', role: '實戰導師', monthly: 28400, yearly: 340800, subs: 10, growth: 18, plans: ['波段佈局週記'] },
];

// Monthly trend data
const monthlyTrend = [
  { month: '2025/09', revenue: 320000 },
  { month: '2025/10', revenue: 355000 },
  { month: '2025/11', revenue: 378000 },
  { month: '2025/12', revenue: 412000 },
  { month: '2026/01', revenue: 435000 },
  { month: '2026/02', revenue: 458000 },
];

const CompanyRevenue = () => {
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const totalMonthly = mockRevenue.reduce((sum, r) => sum + r.monthly, 0);
  const totalYearly = mockRevenue.reduce((sum, r) => sum + r.yearly, 0);
  const totalSubs = mockRevenue.reduce((s, r) => s + r.subs, 0);
  const avgRevenuePerSub = Math.round(totalMonthly / totalSubs);

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">營收數據</h1>
            <p className="text-muted-foreground text-sm mt-1">全平台營收與訂閱數據分析</p>
          </div>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            匯出報表
          </Button>
        </div>

        {/* Top Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">本月總營收</span>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold">NT${totalMonthly.toLocaleString()}</div>
              <div className="text-xs mt-1 flex items-center gap-1 text-green-600 dark:text-green-400">
                <ArrowUpRight className="h-3 w-3" />+15% vs 上月
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">年度營收</span>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold">NT${totalYearly.toLocaleString()}</div>
              <div className="text-xs mt-1 text-muted-foreground">2026 年度累計</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">總訂閱者</span>
                <Users className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold">{totalSubs}</div>
              <div className="text-xs mt-1 flex items-center gap-1 text-green-600 dark:text-green-400">
                <ArrowUpRight className="h-3 w-3" />+8 本月
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">每位訂閱者均收</span>
              </div>
              <div className="text-2xl font-bold">NT${avgRevenuePerSub.toLocaleString()}</div>
              <div className="text-xs mt-1 text-muted-foreground">ARPU / 月</div>
            </CardContent>
          </Card>
        </div>

        {/* Monthly Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">月營收趨勢</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 h-32">
              {monthlyTrend.map((m) => {
                const maxRev = Math.max(...monthlyTrend.map(t => t.revenue));
                const height = (m.revenue / maxRev) * 100;
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">NT${(m.revenue / 1000).toFixed(0)}K</span>
                    <div
                      className="w-full bg-primary/20 rounded-t"
                      style={{ height: `${height}%` }}
                    >
                      <div className="w-full h-full bg-primary/60 rounded-t" />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{m.month.split('/')[1]}月</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Per-Analyst Revenue */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">各分析師營收明細</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="p-4">分析師</th>
                  <th className="p-4">角色</th>
                  <th className="p-4">方案</th>
                  <th className="p-4">月營收</th>
                  <th className="p-4">年營收</th>
                  <th className="p-4">訂閱數</th>
                  <th className="p-4">月成長</th>
                </tr>
              </thead>
              <tbody>
                {mockRevenue
                  .sort((a, b) => b.monthly - a.monthly)
                  .map((r) => (
                  <tr key={r.slug} className="border-b last:border-0">
                    <td className="p-4 font-medium text-sm">{r.name}</td>
                    <td className="p-4">
                      <Badge variant={r.role === '投顧分析師' ? 'default' : 'secondary'} className="text-xs">
                        {r.role}
                      </Badge>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1">
                        {r.plans.map((p) => (
                          <Badge key={p} variant="outline" className="text-[10px]">{p}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="p-4 text-sm font-medium">NT${r.monthly.toLocaleString()}</td>
                    <td className="p-4 text-sm">NT${r.yearly.toLocaleString()}</td>
                    <td className="p-4 text-sm">{r.subs}</td>
                    <td className="p-4">
                      <span className={`text-sm font-medium ${r.growth >= 0 ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
                        {r.growth >= 0 ? '+' : ''}{r.growth}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
};

export default CompanyRevenue;
