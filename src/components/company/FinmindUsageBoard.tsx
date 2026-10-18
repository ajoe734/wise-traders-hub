import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw, Gauge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useFreshness } from '@/checkup/lib/freshness';
import { dailyFinmindUsage, loadFinmindJobs, quotaState, usageWindow, type QuotaObservation, type FinmindJob } from '@/lib/finmindUsage';

const labels = { unknown: '額度未知', stale: '觀測已過期', exhausted: '額度已用完', critical: '即將用完（≤10%）', warning: '額度偏低（≤20%）', normal: '額度正常' };
function QuotaRow({ row }: { row: QuotaObservation }) {
  const freshness = useFreshness(Date.parse(row.observed_at), 3600000);
  const state = quotaState(row);
  const warning = ['exhausted', 'critical', 'warning'].includes(state);
  return <div className="border-b border-border py-3 last:border-0">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold break-all">{row.source}</span><Badge variant={warning ? 'destructive' : 'outline'}>{labels[state]}</Badge></div>
    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2"><span className="font-mono text-lg tabular-nums">剩餘 {state === 'stale' || row.remaining == null ? '—' : row.remaining.toLocaleString()} <span className="text-sm text-muted-foreground">/ {row.quota_limit?.toLocaleString() ?? '未知'} 次</span></span><span className="text-xs text-muted-foreground" title={row.observed_at}>觀測 {freshness.label}</span></div>
    {row.reset_at && <p className="mt-1 text-xs text-muted-foreground">重置 {new Date(row.reset_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}</p>}
  </div>;
}
export function FinmindUsageBoard() {
  const query = useQuery({
    queryKey: ['company', 'finmind-financial-usage'],
    queryFn: async () => {
      const [jobs, quota] = await Promise.all([
        loadFinmindJobs(offset => supabase.from('system_jobs_log').select('ran_at,job_name,detail').in('job_name', ['market_data_sync', 'valuation_ps_sync']).gte('ran_at', usageWindow()).order('ran_at', { ascending: false }).order('id').range(offset, offset + 999) as unknown as PromiseLike<{ data: FinmindJob[] | null; error: unknown }>),
        supabase.from('finmind_upstream_quota').select('source,remaining,quota_limit,reset_at,observed_at').ilike('source', 'finmind%').order('observed_at', { ascending: false }),
      ]);
      if (quota.error) throw quota.error;
      return { days: dailyFinmindUsage(jobs), quota: (quota.data ?? []) as QuotaObservation[] };
    },
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });
  const today = query.data?.days[0];
  return <section aria-label="財報額度用量" className="space-y-4 border-b border-border pb-6">
    <div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-lg font-bold text-foreground"><Gauge className="h-4 w-4 shrink-0" />財報額度用量</h2><Button size="icon" variant="outline" aria-label="更新財報額度" title="更新財報額度" onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`} /></Button></div>
    {query.isPending ? <p role="status">載入中…</p> : query.isError ? <div role="alert" className="flex flex-wrap items-center gap-3 text-destructive"><AlertTriangle className="h-4 w-4" />無法讀取額度紀錄<Button variant="outline" onClick={() => query.refetch()}>重試</Button></div> : <>
      {!!today?.stops && <p role="alert" className="flex items-center gap-2 text-sm font-semibold text-destructive"><AlertTriangle className="h-4 w-4 shrink-0" />今日 {today.stops} 輪因上游額度耗盡停止</p>}
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-4">{[['今日完成檔數', today?.unique == null ? '未完整記錄' : `${today.unique} 檔`], ['財報更新', `${today?.filings ?? 0} 檔次`], ['歷史股價回補', `${today?.history ?? 0} 檔次`], ['額度耗盡停抓', `${today?.stops ?? 0} 輪`]].map(([label, value]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-bold text-foreground tabular-nums">{value}</p></div>)}</div>
      <div><h3 className="text-sm font-bold">FinMind 上游剩餘額度</h3>{!query.data?.quota.length ? <p className="mt-2 text-sm text-muted-foreground">未知：尚未收到上游額度標頭，無法判斷剩餘量。</p> : query.data.quota.map(row => <QuotaRow key={row.source} row={row} />)}</div>
      <p className="text-xs text-muted-foreground">台北日期 · 檔次包含重複更新；檔數依成功代碼去重。舊紀錄未保存代碼時不推估檔數。API 次數與股票檔數不同，剩餘量不是系統內部分配額度。</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[510px] text-sm tabular-nums"><thead><tr className="border-b border-border text-muted-foreground">{['日期', '完成檔數', '財報檔次', '股價檔次', '停抓輪數'].map(s => <th key={s} className="px-2 py-2 text-right first:text-left font-medium">{s}</th>)}</tr></thead><tbody>{query.data?.days.map(d => <tr key={d.day} className="border-b border-border"><td className="px-2 py-2 font-mono">{d.day.replace(/-/g, '/')}</td><td className="px-2 py-2 text-right">{d.unique ?? '未完整記錄'}</td><td className="px-2 py-2 text-right">{d.filings}</td><td className="px-2 py-2 text-right">{d.history}</td><td className={`px-2 py-2 text-right ${d.stops ? 'text-destructive font-semibold' : ''}`}>{d.stops}</td></tr>)}</tbody></table></div>
    </>}
  </section>;
}