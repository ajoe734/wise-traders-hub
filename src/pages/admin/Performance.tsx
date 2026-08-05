import { SEO } from '@/components/SEO';
import { useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrendingUp, BarChart3 } from 'lucide-react';
import { useAdminPerformanceData } from '@/hooks/admin/useAdminPerformanceData';
import CapitalSummaryCard from '@/pages/_adminPerformance/CapitalSummaryCard';
import UnrealizedTab from '@/pages/_adminPerformance/UnrealizedTab';
import RealizedTab from '@/pages/_adminPerformance/RealizedTab';
import { FxRateFootnote } from '@/components/FxHint';
import { FactsheetExportDialog } from '@/components/admin/FactsheetExportDialog';

const AdminPerformance = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const {
    expertRole, expertCurrency, capital, totalPnlPercent, avgPnlPercent,
    rows, realizedRows, loading, realizedLoading,
    realizedPeriod, setRealizedPeriod,
    unrealizedSummary, realizedSummary,
  } = useAdminPerformanceData(expertSlug);

  return (
    <AdminLayout>
      <SEO title={`${expertSlug || ''} 績效 | legendflow`} description={'歷史績效與績效報表。'} path={`/admin/${expertSlug || ''}/performance`} noindex />
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">績效總覽</h1>
            <p className="text-muted-foreground text-sm mt-1">
              區分未實現與已實現損益，已實現僅計算賣出與減碼
            </p>
          </div>
          <FactsheetExportDialog expertSlug={expertSlug} />
        </div>

        {capital && <CapitalSummaryCard capital={capital} currency={expertCurrency} />}
        {expertCurrency === 'USD' && <FxRateFootnote />}

        <Tabs defaultValue="unrealized" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2 max-w-sm">
            <TabsTrigger value="unrealized" className="gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" />
              未實現損益
            </TabsTrigger>
            <TabsTrigger value="realized" className="gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" />
              已實現損益
            </TabsTrigger>
          </TabsList>

          <TabsContent value="unrealized">
            <UnrealizedTab
              rows={rows}
              loading={loading}
              totalPnlPercent={totalPnlPercent}
              avgPnlPercent={avgPnlPercent}
              count={unrealizedSummary.count}
            />
          </TabsContent>

          <TabsContent value="realized">
            <RealizedTab
              realizedPeriod={realizedPeriod}
              setRealizedPeriod={setRealizedPeriod}
              expertRole={expertRole}
              realizedRows={realizedRows}
              realizedLoading={realizedLoading}
              summary={realizedSummary}
            />
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
};

export default AdminPerformance;
