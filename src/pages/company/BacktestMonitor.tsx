import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Activity, RefreshCw, PlayCircle, Bell, AlertTriangle } from 'lucide-react';
import { useBacktestMonitor } from '@/hooks/company/useBacktestMonitor';
import { computeSteps } from '@/pages/_backtestMonitor/computeSteps';
import { PipelineSteps } from '@/pages/_backtestMonitor/PipelineSteps';
import { FailedBackfillsCard } from '@/pages/_backtestMonitor/FailedBackfillsCard';
import { NotifyIssueCard } from '@/pages/_backtestMonitor/NotifyIssueCard';
import { StatsRow } from '@/pages/_backtestMonitor/StatsRow';
import { BackfillDetailCard } from '@/pages/_backtestMonitor/BackfillDetailCard';
import { RunsTable } from '@/pages/_backtestMonitor/RunsTable';

export default function BacktestMonitor() {
  const {
    snapshot, loading, busyId, busyAll,
    load, triggerNightly, sendNotify, retryItem,
  } = useBacktestMonitor();

  const runs = snapshot?.runs ?? [];
  const items = snapshot?.items ?? {};
  const failedBackfills = snapshot?.failedBackfills ?? [];
  const failedBackfillReasons = snapshot?.failedBackfillReasons ?? [];
  const notifyLog = snapshot?.notifyLog ?? null;
  const backfill = snapshot?.backfill ?? null;
  const lastCron = snapshot?.lastCron ?? null;

  const last24 = runs.filter(r => Date.now() - new Date(r.created_at).getTime() < 86400_000);
  const success24 = last24.filter(r => r.status === 'completed').length;
  const failed24 = last24.filter(r => r.status === 'failed').length;

  const steps = computeSteps({
    backfill, failedBackfillReasons, runs, last24, success24, failed24, notifyLog,
  });

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6" /> 回測排程監控
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              每晚 22:00（台北）自動執行 <code>knowledge-backtest</code> full 模式。完成後自動 Email 通知所有 company_admin。
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 重新整理
            </Button>
            <Button variant="outline" size="sm" onClick={sendNotify} disabled={busyAll === 'notify'}>
              <Bell className="h-4 w-4" /> {busyAll === 'notify' ? '送出中…' : '補發 Email 通知（24h）'}
            </Button>
            <Button size="sm" onClick={triggerNightly} disabled={busyAll === 'cron'}>
              <PlayCircle className="h-4 w-4" /> {busyAll === 'cron' ? '執行中…' : '立即執行完整回測'}
            </Button>
          </div>
        </div>

        {backfill && backfill.done < 100 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            ⚠️ 目前 daily_price_snapshots 只有少量股票，回測樣本不足（多數知識條目會 sample_size &lt; 30，無法通過驗證門檻）。
            待回填批次完成（pending=0）後會自動觸發 full 回測；勝率/樣本數摘要會以 Email 寄達。
          </div>
        )}

        <PipelineSteps steps={steps} />
        <FailedBackfillsCard reasons={failedBackfillReasons} failedBackfills={failedBackfills} />
        <NotifyIssueCard notifyLog={notifyLog} />
        <StatsRow lastCron={lastCron} success24={success24} failed24={failed24} backfill={backfill} />
        <BackfillDetailCard backfill={backfill} />

        {failed24 > 0 && (
          <Card className="border-red-300 bg-red-50/50">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
              <div className="text-sm text-red-800">
                最近 24 小時有 <b>{failed24}</b> 筆回測失敗。請至下方表格點「重試」或檢查錯誤訊息（多半是
                <code className="mx-1 px-1 bg-white rounded">INSUFFICIENT_DATA</code>，需先回填股價）。
              </div>
            </CardContent>
          </Card>
        )}

        <RunsTable
          runs={runs}
          items={items}
          loading={loading}
          busyId={busyId}
          onRetry={(id) => retryItem(id, items)}
        />
      </div>
    </CompanyLayout>
  );
}
