import { SEO } from '@/components/SEO';
import { useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Download, Search, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

interface LogRow {
  id: string;
  created_at: string;
  fn: string;
  run_id: string;
  level: string;
  stage: string | null;
  msg: string | null;
  expert_id: string | null;
  signal_id: string | null;
  payload: any;
}

export default function FunctionLogs() {
  const [runId, setRunId] = useState('');
  const [fnFilter, setFnFilter] = useState('publish-weekly-journals');
  const [submitted, setSubmitted] = useState<{ fn: string; runId: string } | null>(null);

  const { data: rows = [], isFetching: loading, refetch } = useQuery<LogRow[]>({
    queryKey: ['company', 'function-logs', submitted?.fn ?? '', submitted?.runId ?? ''],
    enabled: !!submitted,
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase.from('function_run_logs')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(1000);
      if (submitted?.runId) q = q.eq('run_id', submitted.runId);
      if (submitted?.fn) q = q.eq('fn', submitted.fn);
      const { data, error } = await q;
      if (error) throw error;
      if (!data?.length) toast.info('查無紀錄');
      return (data ?? []) as LogRow[];
    },
  });

  const fetchLogs = () => {
    const next = { fn: fnFilter.trim(), runId: runId.trim() };
    if (submitted && submitted.fn === next.fn && submitted.runId === next.runId) {
      refetch();
    } else {
      setSubmitted(next);
    }
  };

  const downloadJson = () => {
    if (!rows.length) return;
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fnFilter || 'function'}-${runId || 'all'}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadNdjson = () => {
    if (!rows.length) return;
    const text = rows.map(r => JSON.stringify(r.payload)).join('\n');
    const blob = new Blob([text], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fnFilter || 'function'}-${runId || 'all'}-${Date.now()}.ndjson`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const levelColor = (lvl: string) =>
    lvl === 'error' ? 'destructive' : lvl === 'warn' ? 'secondary' : 'default';

  return (
    <CompanyLayout>
      <SEO title={'Function 日誌 | legendflow'} description={'Edge function 執行紀錄與錯誤追蹤。'} path={'/company/function-logs'} noindex />
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">函式執行日誌</h1>
          <p className="text-sm text-muted-foreground mt-1">
            依 runId 查詢 Edge Function 的結構化日誌，可下載 JSON / NDJSON。
          </p>
        </div>

        <Card className="p-4">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground">函式名稱</label>
              <Input list="fn-presets" value={fnFilter} onChange={e => setFnFilter(e.target.value)} placeholder="publish-weekly-journals" />
              <datalist id="fn-presets">
                <option value="publish-weekly-journals" />
                <option value="backfill-worker" />
              </datalist>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground">Run ID</label>
              <Input value={runId} onChange={e => setRunId(e.target.value)} placeholder="例：a1b2c3d4" />
            </div>
            <Button onClick={fetchLogs} disabled={loading} className="gap-2">
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              查詢
            </Button>
            <Button variant="outline" onClick={downloadJson} disabled={!rows.length} className="gap-2">
              <Download className="h-4 w-4" /> JSON
            </Button>
            <Button variant="outline" onClick={downloadNdjson} disabled={!rows.length} className="gap-2">
              <Download className="h-4 w-4" /> NDJSON
            </Button>
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="max-h-[70vh] overflow-auto">
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead className="bg-muted sticky top-0">
                <tr className="text-left">
                  <th className="p-2">時間</th>
                  <th className="p-2">Level</th>
                  <th className="p-2">Stage</th>
                  <th className="p-2">Run</th>
                  <th className="p-2">Expert</th>
                  <th className="p-2">Signal</th>
                  <th className="p-2">訊息</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t align-top hover:bg-muted/30">
                    <td className="p-2 whitespace-nowrap font-mono">
                      {new Date(r.created_at).toISOString().replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="p-2">
                      <Badge variant={levelColor(r.level) as any}>{r.level}</Badge>
                    </td>
                    <td className="p-2 whitespace-nowrap">{r.stage ?? '-'}</td>
                    <td className="p-2 font-mono">{r.run_id}</td>
                    <td className="p-2 font-mono">{r.expert_id ? r.expert_id.slice(0, 8) : '-'}</td>
                    <td className="p-2 font-mono">{r.signal_id ? r.signal_id.slice(0, 8) : '-'}</td>
                    <td className="p-2">
                      <details>
                        <summary className="cursor-pointer">{r.msg}</summary>
                        <pre className="mt-1 bg-muted p-2 rounded text-[10px] overflow-auto max-w-[600px]">
                          {JSON.stringify(r.payload, null, 2)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">尚無資料</td></tr>
                )}
              </tbody>
            </table></div>
          </div>
        </Card>
      </div>
    </CompanyLayout>
  );
}
