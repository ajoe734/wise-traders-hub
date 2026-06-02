import { lazy, Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TabsContent } from '@/components/ui/tabs';
import { Download } from 'lucide-react';
import { StatCard } from './StatCard';
import { ChartFallback } from './ChartFallback';
import { exportCSV, fmtDate, fmtMoney } from './utils';

const CheckupTrendChart = lazy(() => import('@/components/company/RevenueCharts').then(m => ({ default: m.CheckupTrendChart })));

interface Props {
  checkupOverview: any;
  checkupTrend: any[];
  checkupSubs: any[];
  checkupPlanMap: Record<string, any>;
  profileMap: Record<string, any>;
}

export function CheckupTab({ checkupOverview, checkupTrend, checkupSubs, checkupPlanMap, profileMap }: Props) {
  return (
    <TabsContent value="checkup" className="mt-4 space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="健檢毛收" value={fmtMoney(checkupOverview.gross)} hint={`${checkupOverview.count} 筆`} />
        <StatCard label="健檢折扣" value={fmtMoney(checkupOverview.discount)} />
        <StatCard label="健檢淨收" value={fmtMoney(checkupOverview.net)} variant="primary" />
        <StatCard label="活躍訂閱" value={String(checkupSubs.filter(c => c.status === 'active').length)} />
      </div>

      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          健檢方案規則：平台 100%、專家 0%（不分潤）。所有健檢淨收皆計入平台口袋。
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">健檢月趨勢</CardTitle></CardHeader>
        <CardContent>
          {checkupTrend.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">尚無資料</p>
          ) : (
            <Suspense fallback={<ChartFallback height={240} />}>
              <CheckupTrendChart data={checkupTrend} />
            </Suspense>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => {
          exportCSV(`checkup-subs-${new Date().toISOString().slice(0, 10)}.csv`, [
            ['用戶', '方案', '週期', '狀態', '續訂模式', '起始日', '到期日'],
            ...checkupSubs.map(c => {
              const buyer = profileMap[c.user_id];
              const plan = checkupPlanMap[c.plan_id];
              return [
                buyer?.display_name || '-',
                plan?.name || '-',
                c.billing_cycle === 'yearly' ? '年' : '月',
                c.status,
                c.auto_renew ? '自動' : '手動',
                fmtDate(c.started_at),
                fmtDate(c.expires_at),
              ];
            }),
          ]);
        }}>
          <Download className="h-4 w-4 mr-2" />匯出健檢訂閱
        </Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="p-3">用戶</th>
                <th className="p-3">方案</th>
                <th className="p-3">週期</th>
                <th className="p-3">狀態</th>
                <th className="p-3">續訂模式</th>
                <th className="p-3">起始日</th>
                <th className="p-3">到期日</th>
              </tr>
            </thead>
            <tbody>
              {checkupSubs.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">尚無健檢訂閱</td></tr>
              ) : checkupSubs.map(c => {
                const buyer = profileMap[c.user_id];
                const plan = checkupPlanMap[c.plan_id];
                return (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="p-3">{buyer?.display_name || '-'}</td>
                    <td className="p-3">{plan?.name || '-'}</td>
                    <td className="p-3">{c.billing_cycle === 'yearly' ? '年' : '月'}</td>
                    <td className="p-3"><Badge variant={c.status === 'active' ? 'default' : 'outline'} className="text-xs">{c.status}</Badge></td>
                    <td className="p-3">{c.auto_renew ? '自動' : '手動'}</td>
                    <td className="p-3">{fmtDate(c.started_at)}</td>
                    <td className="p-3">{fmtDate(c.expires_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </TabsContent>
  );
}
