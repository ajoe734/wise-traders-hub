import { lazy, Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';
import { StatCard } from './StatCard';
import { ChartFallback } from './ChartFallback';
import { fmtMoney } from './utils';

const MonthTrendChart = lazy(() => import('@/components/company/RevenueCharts').then(m => ({ default: m.MonthTrendChart })));
const SourceBreakdownChart = lazy(() => import('@/components/company/RevenueCharts').then(m => ({ default: m.SourceBreakdownChart })));

interface Props {
  overview: any;
  monthTrend: any[];
  sourceBreakdown: any[];
}

export function OverviewTab({ overview, monthTrend, sourceBreakdown }: Props) {
  return (
    <TabsContent value="overview" className="mt-4 space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="毛收" value={fmtMoney(overview.gross)} hint={`${overview.splitsCount} 筆分潤`} />
        <StatCard label="折扣" value={fmtMoney(overview.discount)} />
        <StatCard label="淨收（會計口徑）" value={fmtMoney(overview.net)} hint="不含退款" />
        <StatCard label="退款" value={fmtMoney(overview.refundAmount)} hint={`${overview.refundCount} 筆`} variant="destructive" />
        <StatCard label="平台應得" value={fmtMoney(overview.platformAmount)} variant="primary" />
        <StatCard label="專家應分總額" value={fmtMoney(overview.expertAmount)} variant="primary" />
        <StatCard label="訂閱毛收" value={fmtMoney(overview.subscriptionGross)} />
        <StatCard label="健檢毛收" value={fmtMoney(overview.checkupGross)} />
      </div>

      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
          <p>• 「淨收」= revenue_splits 加總，不會因退款回沖。</p>
          <p>• 「實際淨收」≈ 淨收 − 退款 = <span className="font-medium text-foreground">{fmtMoney(overview.net - overview.refundAmount)}</span></p>
          <p>• 退款獨立顯示，金流商退款 API 只更新 payment_transactions.status，不反沖 revenue_splits。</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">月營收趨勢</CardTitle></CardHeader>
          <CardContent>
            {monthTrend.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">尚無資料</p>
            ) : (
              <Suspense fallback={<ChartFallback height={260} />}>
                <MonthTrendChart data={monthTrend} />
              </Suspense>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">金流來源拆分</CardTitle></CardHeader>
          <CardContent>
            {sourceBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">尚無資料</p>
            ) : (
              <Suspense fallback={<ChartFallback height={260} />}>
                <SourceBreakdownChart data={sourceBreakdown} />
              </Suspense>
            )}
          </CardContent>
        </Card>
      </div>
    </TabsContent>
  );
}
