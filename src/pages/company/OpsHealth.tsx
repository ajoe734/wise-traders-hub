import { useState } from 'react';
import { SEO } from '@/components/SEO';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Activity, AlertTriangle, Database, Gauge, Trash2, Snowflake } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

interface FnRow { fn: string; runs: number; errors: number; warns: number; error_rate: number; last_seen: string | null; }
interface JobRow { job_name: string; runs: number; success: number; fail: number; p95_ms: number | null; last_status: string | null; last_ran_at: string | null; }
interface TableRow { table: string; total: number; older_than_7d: number; older_than_30d: number; }
interface ErrRow { id: string; created_at: string; fn: string; stage: string | null; msg: string | null; run_id: string; }
interface ColdRow { fn: string; boots_7d: number; boots_24h: number; last_boot_at: string | null; }

interface HealthResp {
  generatedAt: string;
  windowDays: number;
  functions: FnRow[];
  jobs: JobRow[];
  logTables: TableRow[];
  coldStarts: ColdRow[];
  recentErrors: ErrRow[];
}

const fmtDT = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtNum = (n: number) => n.toLocaleString();

export default function OpsHealth() {
  const { data, isFetching, refetch, error } = useQuery<HealthResp>({
    queryKey: ['company', 'ops-health'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('ops-health', { method: 'POST' });
      if (error) throw error;
      return data as HealthResp;
    },
  });

  const [cleaning, setCleaning] = useState(false);
  const totalLogRows = (data?.logTables ?? []).reduce((s, t) => s + t.total, 0);
  const totalErrors7d = (data?.functions ?? []).reduce((s, f) => s + f.errors, 0);
  const failedJobs7d = (data?.jobs ?? []).reduce((s, j) => s + j.fail, 0);

  const runCleanup = async () => {
    if (!confirm('立即執行 log 清理？\n• function_run_logs > 30d\n• system_jobs_log > 90d\n• audit_logs > 365d\n• perf_metrics > 14d\n• traffic_events > 30d')) return;
    setCleaning(true);
    try {
      const { data: res, error: err } = await supabase.functions.invoke('cleanup-ops-logs', { method: 'POST' });
      if (err) throw err;
      const total = Object.values(res?.summary ?? {}).reduce((s: number, v: any) => s + (v?.deleted ?? 0), 0);
      toast.success(`清理完成：刪除 ${total.toLocaleString()} 筆，耗時 ${res?.duration_ms}ms`);
      refetch();
    } catch (e: any) {
      toast.error(`清理失敗：${e.message ?? e}`);
    } finally {
      setCleaning(false);
    }
  };

  return (
    <CompanyLayout>
      <SEO title={'後端健康 / 成本 | legendflow'} description={'Edge function 與排程任務健康度、log 表大小、清理建議。'} path={'/company/ops-health'} noindex />
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">後端健康 / 成本</h1>
            <p className="text-sm text-muted-foreground mt-1">
              近 7 天 edge function 與排程任務聚合，加上各 log 表大小與保留建議。
              {data?.generatedAt && <span className="ml-2">最後更新：{fmtDT(data.generatedAt)}</span>}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            重新整理
          </Button>
        </div>

        {error && (
          <Card className="p-4 border-destructive/50 bg-destructive/5 text-sm text-destructive">
            載入失敗：{(error as Error).message}
          </Card>
        )}

        {/* KPI */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={<Activity className="h-4 w-4" />} label="函式總數 (7d)" value={fmtNum(data?.functions.length ?? 0)} />
          <KpiCard icon={<AlertTriangle className="h-4 w-4" />} label="函式錯誤 (7d)" value={fmtNum(totalErrors7d)} tone={totalErrors7d > 0 ? 'warn' : undefined} />
          <KpiCard icon={<Gauge className="h-4 w-4" />} label="排程失敗 (7d)" value={fmtNum(failedJobs7d)} tone={failedJobs7d > 0 ? 'warn' : undefined} />
          <KpiCard icon={<Database className="h-4 w-4" />} label="Log 表總筆數" value={fmtNum(totalLogRows)} />
        </div>

        {/* Functions */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">Edge Function 健康（近 7 天）</h2>
            <Link to="/company/function-logs" className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline">查詢明細 →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 px-2">函式</th>
                  <th className="text-right py-2 px-2">執行</th>
                  <th className="text-right py-2 px-2">警告</th>
                  <th className="text-right py-2 px-2">錯誤</th>
                  <th className="text-right py-2 px-2">錯誤率</th>
                  <th className="text-left py-2 px-2">最後執行</th>
                </tr>
              </thead>
              <tbody>
                {(data?.functions ?? []).map(f => (
                  <tr key={f.fn} className="border-b last:border-0">
                    <td className="py-2 px-2 font-mono text-xs">{f.fn}</td>
                    <td className="py-2 px-2 text-right">{fmtNum(f.runs)}</td>
                    <td className="py-2 px-2 text-right">{f.warns > 0 ? <span className="text-amber-600">{f.warns}</span> : 0}</td>
                    <td className="py-2 px-2 text-right">{f.errors > 0 ? <span className="text-destructive font-medium">{f.errors}</span> : 0}</td>
                    <td className="py-2 px-2 text-right">
                      {f.error_rate >= 5
                        ? <Badge variant="destructive">{f.error_rate}%</Badge>
                        : f.error_rate > 0
                        ? <Badge variant="secondary">{f.error_rate}%</Badge>
                        : <span className="text-muted-foreground">0%</span>}
                    </td>
                    <td className="py-2 px-2 text-xs text-muted-foreground">{fmtDT(f.last_seen)}</td>
                  </tr>
                ))}
                {(!data?.functions || data.functions.length === 0) && (
                  <tr><td colSpan={6} className="py-6 text-center text-muted-foreground text-xs">{isFetching ? '載入中…' : '無紀錄'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Jobs */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">排程任務健康（近 7 天）</h2>
            <Link to="/company/system-jobs" className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline">查詢明細 →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 px-2">任務</th>
                  <th className="text-right py-2 px-2">執行</th>
                  <th className="text-right py-2 px-2">成功</th>
                  <th className="text-right py-2 px-2">失敗</th>
                  <th className="text-right py-2 px-2">p95 (ms)</th>
                  <th className="text-left py-2 px-2">最後狀態</th>
                  <th className="text-left py-2 px-2">最後執行</th>
                </tr>
              </thead>
              <tbody>
                {(data?.jobs ?? []).map(j => (
                  <tr key={j.job_name} className="border-b last:border-0">
                    <td className="py-2 px-2 font-mono text-xs">{j.job_name}</td>
                    <td className="py-2 px-2 text-right">{fmtNum(j.runs)}</td>
                    <td className="py-2 px-2 text-right">{j.success}</td>
                    <td className="py-2 px-2 text-right">{j.fail > 0 ? <span className="text-destructive font-medium">{j.fail}</span> : 0}</td>
                    <td className="py-2 px-2 text-right">{j.p95_ms != null ? fmtNum(j.p95_ms) : '—'}</td>
                    <td className="py-2 px-2">
                      {j.last_status === 'success'
                        ? <Badge variant="secondary">成功</Badge>
                        : j.last_status
                        ? <Badge variant="destructive">{j.last_status}</Badge>
                        : '—'}
                    </td>
                    <td className="py-2 px-2 text-xs text-muted-foreground">{fmtDT(j.last_ran_at)}</td>
                  </tr>
                ))}
                {(!data?.jobs || data.jobs.length === 0) && (
                  <tr><td colSpan={7} className="py-6 text-center text-muted-foreground text-xs">{isFetching ? '載入中…' : '無紀錄'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Log table sizes */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h2 className="font-medium">Log 表大小 / 成本控制</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground hidden sm:inline">保留策略：30/90/365/14/30 天</span>
              <Button variant="outline" size="sm" onClick={runCleanup} disabled={cleaning}>
                <Trash2 className={`h-4 w-4 mr-2 ${cleaning ? 'animate-pulse' : ''}`} />
                {cleaning ? '清理中…' : '立即執行清理'}
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 px-2">資料表</th>
                  <th className="text-right py-2 px-2">總筆數</th>
                  <th className="text-right py-2 px-2">&gt; 7 天</th>
                  <th className="text-right py-2 px-2">&gt; 30 天</th>
                  <th className="text-left py-2 px-2">建議</th>
                </tr>
              </thead>
              <tbody>
                {(data?.logTables ?? []).map(t => {
                  const ratio7 = t.total ? t.older_than_7d / t.total : 0;
                  const advice = t.older_than_30d > 10000
                    ? <Badge variant="destructive">建議清理 30d 以上</Badge>
                    : ratio7 > 0.5
                    ? <Badge variant="secondary">建議排程清理 7d 以上</Badge>
                    : <span className="text-muted-foreground text-xs">健康</span>;
                  return (
                    <tr key={t.table} className="border-b last:border-0">
                      <td className="py-2 px-2 font-mono text-xs">{t.table}</td>
                      <td className="py-2 px-2 text-right">{fmtNum(t.total)}</td>
                      <td className="py-2 px-2 text-right">{fmtNum(t.older_than_7d)}</td>
                      <td className="py-2 px-2 text-right">{fmtNum(t.older_than_30d)}</td>
                      <td className="py-2 px-2">{advice}</td>
                    </tr>
                  );
                })}
                {(!data?.logTables || data.logTables.length === 0) && (
                  <tr><td colSpan={5} className="py-6 text-center text-muted-foreground text-xs">{isFetching ? '載入中…' : '無資料'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Cold starts */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium flex items-center gap-2"><Snowflake className="h-4 w-4 text-sky-600" />冷啟動頻率（近 7 天）</h2>
            <span className="text-xs text-muted-foreground">每次 process boot 紀錄一筆；高頻率代表常被回收。</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 px-2">函式</th>
                  <th className="text-right py-2 px-2">7 天冷啟次數</th>
                  <th className="text-right py-2 px-2">24 小時</th>
                  <th className="text-left py-2 px-2">最後冷啟</th>
                </tr>
              </thead>
              <tbody>
                {(data?.coldStarts ?? []).map(c => (
                  <tr key={c.fn} className="border-b last:border-0">
                    <td className="py-2 px-2 font-mono text-xs">{c.fn}</td>
                    <td className="py-2 px-2 text-right">{c.boots_7d >= 50 ? <Badge variant="destructive">{fmtNum(c.boots_7d)}</Badge> : c.boots_7d >= 20 ? <Badge variant="secondary">{fmtNum(c.boots_7d)}</Badge> : fmtNum(c.boots_7d)}</td>
                    <td className="py-2 px-2 text-right">{fmtNum(c.boots_24h)}</td>
                    <td className="py-2 px-2 text-xs text-muted-foreground">{fmtDT(c.last_boot_at)}</td>
                  </tr>
                ))}
                {(!data?.coldStarts || data.coldStarts.length === 0) && (
                  <tr><td colSpan={4} className="py-6 text-center text-muted-foreground text-xs">{isFetching ? '載入中…' : '暫無冷啟動紀錄（部署後需累積一段時間）'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Recent errors */}
        <Card className="p-4">
          <h2 className="font-medium mb-3">近 24 小時錯誤（最多 50 筆）</h2>
          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {(data?.recentErrors ?? []).map(e => (
              <div key={e.id} className="text-xs border-b last:border-0 py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="destructive">error</Badge>
                  <span className="font-mono">{e.fn}</span>
                  {e.stage && <span className="text-muted-foreground">/ {e.stage}</span>}
                  <span className="text-muted-foreground ml-auto">{fmtDT(e.created_at)}</span>
                </div>
                {e.msg && <div className="mt-1 text-foreground/80 break-all">{e.msg}</div>}
                <div className="mt-1 text-[10px] text-muted-foreground font-mono">run_id: {e.run_id}</div>
              </div>
            ))}
            {(!data?.recentErrors || data.recentErrors.length === 0) && (
              <div className="py-6 text-center text-muted-foreground text-xs">{isFetching ? '載入中…' : '近 24 小時無錯誤 ✓'}</div>
            )}
          </div>
        </Card>
      </div>
    </CompanyLayout>
  );
}

function KpiCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: 'warn' }) {
  return (
    <Card className={`p-4 ${tone === 'warn' ? 'border-destructive/40' : ''}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone === 'warn' ? 'text-destructive' : ''}`}>{value}</div>
    </Card>
  );
}
