import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { useRevenueData, type RevenuePreset } from '@/hooks/useRevenueData';
import { useRevenueRefund } from '@/hooks/company/useRevenueRefund';
import { fmtDate } from '@/pages/_companyRevenue/utils';
import { OverviewTab } from '@/pages/_companyRevenue/OverviewTab';
import { SubscriptionsTab } from '@/pages/_companyRevenue/SubscriptionsTab';
import { TransactionsTab } from '@/pages/_companyRevenue/TransactionsTab';
import { PayoutsTab } from '@/pages/_companyRevenue/PayoutsTab';
import { CheckupTab } from '@/pages/_companyRevenue/CheckupTab';
import { RefundDialog } from '@/pages/_companyRevenue/RefundDialog';

const CompanyRevenue = () => {
  const [preset, setPreset] = useState<RevenuePreset>('this_month');

  const {
    subscriptions, checkupSubs, experts, checkupSubsRaw,
    paidTxTotalCount, splitTotalCount,
    expertMap, planMap, checkupPlanMap, profileMap, providerMap,
    overview, monthTrend, sourceBreakdown, txMerged,
    expertPayouts, splitsByExpert, checkupOverview, checkupTrend,
    range,
    invalidate: fetchAll,
  } = useRevenueData(preset) as any;

  const {
    refundingTx, setRefundingTx, refundReason, setRefundReason, handleRefund, close,
  } = useRevenueRefund(providerMap, fetchAll);

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">對帳中心</h1>
            <p className="text-muted-foreground text-sm mt-1">會計口徑營收、訂閱、金流、專家分潤對帳（資料以 revenue_splits 為主）</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={preset} onValueChange={(v) => setPreset(v as any)}>
              <SelectTrigger className="w-[160px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="this_month">本月</SelectItem>
                <SelectItem value="last_month">上月</SelectItem>
                <SelectItem value="last_3m">近三個月</SelectItem>
                <SelectItem value="ytd">今年至今</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">{fmtDate(range.from.toISOString())} ~ {fmtDate(range.to.toISOString())}</span>
          </div>
        </div>

        {paidTxTotalCount !== splitTotalCount && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>對帳健康度警示</AlertTitle>
            <AlertDescription>
              已付款交易共 {paidTxTotalCount} 筆，但分潤紀錄只有 {splitTotalCount} 筆，差距 {Math.abs(paidTxTotalCount - splitTotalCount)} 筆。
              這可能是早期遺留交易未寫入 revenue_splits。對帳數字會以 revenue_splits 為準。
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">總覽</TabsTrigger>
            <TabsTrigger value="subscriptions">訂閱明細</TabsTrigger>
            <TabsTrigger value="transactions">金流明細</TabsTrigger>
            <TabsTrigger value="payouts">專家分潤</TabsTrigger>
            <TabsTrigger value="checkup">健檢營收</TabsTrigger>
          </TabsList>

          <OverviewTab overview={overview} monthTrend={monthTrend} sourceBreakdown={sourceBreakdown} />

          <SubscriptionsTab
            subscriptions={subscriptions}
            experts={experts}
            planMap={planMap}
            expertMap={expertMap}
            profileMap={profileMap}
          />

          <TransactionsTab
            txMerged={txMerged}
            onRefund={(r) => { setRefundingTx(r); setRefundReason(''); }}
          />

          <PayoutsTab
            expertPayouts={expertPayouts}
            splitsByExpert={splitsByExpert}
            planMap={planMap}
          />

          <CheckupTab
            checkupOverview={checkupOverview}
            checkupTrend={checkupTrend}
            checkupSubs={checkupSubs ?? checkupSubsRaw ?? []}
            checkupPlanMap={checkupPlanMap}
            profileMap={profileMap}
          />
        </Tabs>

        <RefundDialog
          refundingTx={refundingTx}
          refundReason={refundReason}
          setRefundReason={setRefundReason}
          onClose={close}
          onConfirm={handleRefund}
        />
      </div>
    </CompanyLayout>
  );
};

export default CompanyRevenue;
