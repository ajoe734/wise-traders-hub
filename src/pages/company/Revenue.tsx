import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, TrendingUp, ArrowUpRight } from 'lucide-react';

const mockRevenue = [
  { name: '趙彭博（投顧）', slug: 'zhao-pengbo', monthly: 128500, yearly: 1542000, subs: 23 },
  { name: '趙彭博（導師）', slug: 'zhao-pengbo-mentor', monthly: 45800, yearly: 549600, subs: 15 },
];

const CompanyRevenue = () => {
  const totalMonthly = mockRevenue.reduce((sum, r) => sum + r.monthly, 0);
  const totalYearly = mockRevenue.reduce((sum, r) => sum + r.yearly, 0);

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">營收數據</h1>
          <p className="text-muted-foreground text-sm mt-1">全平台營收與訂閱數據</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">本月總營收</span>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold">NT${totalMonthly.toLocaleString()}</div>
              <div className="text-xs mt-1 flex items-center gap-1 text-green-600 dark:text-green-400">
                <ArrowUpRight className="h-3 w-3" />+15%
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
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">總訂閱者</span>
              </div>
              <div className="text-2xl font-bold">{mockRevenue.reduce((s, r) => s + r.subs, 0)}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">各分析師營收明細</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="p-4">分析師</th>
                  <th className="p-4">月營收</th>
                  <th className="p-4">年營收</th>
                  <th className="p-4">活躍訂閱</th>
                </tr>
              </thead>
              <tbody>
                {mockRevenue.map((r) => (
                  <tr key={r.slug} className="border-b last:border-0">
                    <td className="p-4 font-medium text-sm">{r.name}</td>
                    <td className="p-4 text-sm">NT${r.monthly.toLocaleString()}</td>
                    <td className="p-4 text-sm">NT${r.yearly.toLocaleString()}</td>
                    <td className="p-4 text-sm">{r.subs}</td>
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
