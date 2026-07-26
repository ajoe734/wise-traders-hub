import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { Database, Loader2, Play, RefreshCw, Search } from 'lucide-react';

type StatRow = {
  dataset: string | null;
  pending: number;
  running: number;
  done: number;
  failed: number;
  skipped: number;
  oldest_pending: string | null;
};

const DATASET_LABEL: Record<string, string> = {
  chip_fact: '籌碼面分點',
  institutional_daily: '三大法人',
  fundamentals: '基本面',
  total: '總計',
};

function fmtTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleString('zh-TW', { hour12: false })}（${formatDistanceToNow(d, { locale: zhTW, addSuffix: true })}）`;
}

export function BackfillQueueCard() {
  const [scanning, setScanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [scanResult, setScanResult] = useState<Record<string, unknown> | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['company', 'backfill-queue-stats'],
    queryFn: async () => {
      const { data: stats, error } = await supabase.rpc('backfill_queue_stats');
      if (error) throw error;
      return (stats ?? []) as StatRow[];
    },
    refetchInterval: 15_000,
  });

  async function handleScan() {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke('backfill-gap-orchestrator', {
        body: { mode: 'scan_only', lookback_days: 60 },
      });
      if (error) throw new Error(error.message || 'scan failed');
      setScanResult(data as Record<string, unknown>);
      toast.success('缺口掃描完成');
    } catch (e) {
      toast.error(`掃描失敗：${(e as Error).message}`);
    } finally {
      setScanning(false);
    }
  }

  async function handleRun() {
    if (!confirm('確定要將掃描到的缺口入列回填？此動作會消耗 FinMind quota。')) return;
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('backfill-gap-orchestrator', {
        body: { mode: 'run', max_scan_jobs: 500, max_dispatch_jobs: 200, lookback_days: 60 },
      });
      if (error) throw new Error(error.message || 'run failed');
      setScanResult(data as Record<string, unknown>);
      toast.success(`已入列 ${(data as Record<string, number>)?.inserted ?? 0} 個回填 job`);
      await refetch();
    } catch (e) {
      toast.error(`入列失敗：${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Database className="h-4 w-4" />
          Gap-Driven 回填佇列
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleScan} disabled={scanning}>
            {scanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            掃描缺口
          </Button>
          <Button size="sm" onClick={handleRun} disabled={running}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            入列回填
          </Button>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">載入中…</CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {(data ?? []).map((row) => (
            <Card key={row.dataset ?? 'total'}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{DATASET_LABEL[row.dataset ?? 'total'] ?? row.dataset ?? 'total'}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <span className="text-muted-foreground">pending</span>
                  <span className="font-mono text-amber-600">{row.pending}</span>
                  <span className="text-muted-foreground">running</span>
                  <span className="font-mono text-blue-600">{row.running}</span>
                  <span className="text-muted-foreground">done</span>
                  <span className="font-mono text-emerald-600">{row.done}</span>
                  <span className="text-muted-foreground">failed</span>
                  <span className="font-mono text-red-600">{row.failed}</span>
                  <span className="text-muted-foreground">skipped</span>
                  <span className="font-mono text-slate-500">{row.skipped}</span>
                </div>
                {row.oldest_pending && (
                  <div className="text-xs text-muted-foreground pt-1 border-t">
                    最舊 pending: {fmtTime(row.oldest_pending)}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {scanResult && (
        <Card className="bg-muted/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">最近掃描結果</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">mode: {String(scanResult.mode)}</Badge>
              <Badge variant="outline">target_date: {String(scanResult.target_date ?? '—')}</Badge>
              <Badge variant="outline">jobs_submitted: {String(scanResult.jobs_submitted ?? 0)}</Badge>
              <Badge variant="outline">inserted: {String(scanResult.inserted ?? 0)}</Badge>
              <Badge variant="outline">skipped: {String(scanResult.skipped ?? 0)}</Badge>
            </div>
            {scanResult.summary && (
              <pre className="rounded bg-muted p-2 text-xs overflow-auto max-h-32">
                {JSON.stringify(scanResult.summary, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
