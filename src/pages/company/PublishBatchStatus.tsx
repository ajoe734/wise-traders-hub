import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RefreshCw, ExternalLink, PlayCircle } from 'lucide-react';

import { SEO } from '@/components/SEO';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';

type StatusRow = {
  expert_id: string;
  expert_name: string | null;
  expert_slug: string | null;
  market: 'TW' | 'US';
  asset_class: string | null;
  pending_count: number;
  published_this_week: number;
  failed_pending_count: number;
  last_attempt_at: string | null;
  last_error_kind: string | null;
  last_error_msg: string | null;
  last_error_signal_id: string | null;
  last_run_id: string | null;
};

type RunRow = {
  run_id: string;
  started_at: string;
  ended_at: string;
  market: 'TW' | 'US' | 'ALL';
  pending_found: number;
  published: number;
  failed: number;
  pushed: number;
  push_fail: number;
};

type AttemptRow = {
  id: string;
  market: 'TW' | 'US';
  attempt_no: number;
  max_attempts: number;
  status: 'pending_retry' | 'running' | 'succeeded' | 'failed' | 'exhausted';
  scheduled_at: string | null;
  next_retry_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  run_id: string | null;
  parent_attempt_id: string | null;
  root_attempt_id: string | null;
  error_message: string | null;
  response: any;
  trigger_source: string | null;
  created_at: string;
};

const fmtDateTime = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const marketTone = (m: string) =>
  m === 'US' ? 'bg-blue-500/10 text-blue-700 border-blue-500/30' : 'bg-orange-500/10 text-orange-700 border-orange-500/30';

export default function PublishBatchStatusPage() {
  const qc = useQueryClient();
  const [marketFilter, setMarketFilter] = useState<'ALL' | 'TW' | 'US'>('ALL');

  const statusQ = useQuery({
    queryKey: ['company', 'publish-batch', 'status'],
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_publish_batch_status');
      if (error) throw error;
      return (data || []) as StatusRow[];
    },
  });

  const runsQ = useQuery({
    queryKey: ['company', 'publish-batch', 'runs'],
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_publish_batch_runs', { _limit: 20 });
      if (error) throw error;
      return (data || []) as RunRow[];
    },
  });

  const attemptsQ = useQuery({
    queryKey: ['company', 'publish-batch', 'attempts'],
    staleTime: 10_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_publish_batch_attempts', { _limit: 80 });
      if (error) throw error;
      return (data || []) as AttemptRow[];
    },
  });

  const triggerM = useMutation({
    mutationFn: async (market: 'TW' | 'US') => {
      const { data, error } = await supabase.functions.invoke('publish-weekly-journals-runner', {
        body: { market, trigger_source: 'manual' },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any, market) => {
      const resp = (data && (data.response || data)) as any;
      const published = resp?.published ?? 0;
      const failed = resp?.failed ?? 0;
      toast.success(
        `${market} 批次執行完成：發布 ${published}、失敗 ${failed}` +
          (data?.will_retry ? `（將於 ${data?.next_attempt_no} 次重試）` : ''),
        { description: data?.run_id ? `runId ${data.run_id}` : undefined },
      );
      qc.invalidateQueries({ queryKey: ['company', 'publish-batch'] });
    },
    onError: (e: any) => toast.error(`觸發失敗：${e?.message || e}`),
  });

  const rows = useMemo(() => {
    const all = statusQ.data ?? [];
    return marketFilter === 'ALL' ? all : all.filter((r) => r.market === marketFilter);
  }, [statusQ.data, marketFilter]);

  const totals = useMemo(() => {
    const all = statusQ.data ?? [];
    return {
      pending: all.reduce((s, r) => s + (r.pending_count || 0), 0),
      published: all.reduce((s, r) => s + (r.published_this_week || 0), 0),
      failed: all.reduce((s, r) => s + (r.failed_pending_count || 0), 0),
      experts: all.length,
    };
  }, [statusQ.data]);

  return (
    <CompanyLayout>
      <SEO title="本週週記批次狀態｜legendflow 後台" description="每個市場、每位分析師的 publish 狀態、錯誤原因與最後嘗試時間" />
      <div className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground">本週週記批次狀態</h1>
            <p className="text-sm text-muted-foreground mt-1">
              統計來源：`expert_signals` 本週狀態 + `function_run_logs` 近 14 天。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                statusQ.refetch();
                runsQ.refetch();
              }}
            >
              <RefreshCw className="w-4 h-4 mr-1" /> 重新整理
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => triggerM.mutate('TW')}
              disabled={triggerM.isPending}
            >
              <PlayCircle className="w-4 h-4 mr-1" /> 觸發 TW 批次
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => triggerM.mutate('US')}
              disabled={triggerM.isPending}
            >
              <PlayCircle className="w-4 h-4 mr-1" /> 觸發 US 批次
            </Button>
          </div>
        </header>

        {/* Totals */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="待發布" value={totals.pending} tone="warning" />
          <StatCard label="本週已發布" value={totals.published} tone="success" />
          <StatCard label="失敗待處理" value={totals.failed} tone="danger" />
          <StatCard label="出現於本表老師" value={totals.experts} />
        </div>

        {/* Filter */}
        <Tabs value={marketFilter} onValueChange={(v) => setMarketFilter(v as any)}>
          <TabsList>
            <TabsTrigger value="ALL">全部</TabsTrigger>
            <TabsTrigger value="TW">TW</TabsTrigger>
            <TabsTrigger value="US">US</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Expert table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-foreground/70">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">市場</th>
                    <th className="text-left px-3 py-2 font-medium">分析師</th>
                    <th className="text-right px-3 py-2 font-medium">待發布</th>
                    <th className="text-right px-3 py-2 font-medium">本週已發</th>
                    <th className="text-right px-3 py-2 font-medium">失敗</th>
                    <th className="text-left px-3 py-2 font-medium">最後嘗試</th>
                    <th className="text-left px-3 py-2 font-medium">最後錯誤</th>
                  </tr>
                </thead>
                <tbody>
                  {statusQ.isLoading && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">載入中…</td>
                    </tr>
                  )}
                  {!statusQ.isLoading && rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">本週沒有需要顯示的分析師。</td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.expert_id} className="border-t border-border/60 hover:bg-muted/20 align-top">
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={marketTone(r.market)}>{r.market}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{r.expert_name || '—'}</div>
                        <div className="text-xs text-muted-foreground">{r.asset_class}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.pending_count > 0 ? (
                          <span className="text-orange-600 font-semibold">{r.pending_count}</span>
                        ) : '0'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.published_this_week}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.failed_pending_count > 0 ? (
                          <span className="text-red-600 font-semibold">{r.failed_pending_count}</span>
                        ) : '0'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {fmtDateTime(r.last_attempt_at)}
                        {r.last_run_id && (
                          <div className="text-[11px] opacity-60">run {r.last_run_id.slice(0, 8)}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 max-w-[520px]">
                        {r.last_error_kind ? (
                          <div>
                            <Badge variant="outline" className="mb-1 border-red-500/40 text-red-700 bg-red-500/5">
                              {r.last_error_kind}
                            </Badge>
                            <div className="text-xs text-foreground/80 line-clamp-3 break-words">
                              {r.last_error_msg}
                            </div>
                            {r.last_error_signal_id && r.expert_slug && (
                              <a
                                href={`/mentor-admin/signals?signal=${r.last_error_signal_id}`}
                                className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                              >
                                跳至該筆訊號 <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Recent runs */}
        <section>
          <h2 className="text-sm font-semibold text-foreground/80 mb-2">近 14 天批次執行</h2>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-foreground/70">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">開始時間</th>
                      <th className="text-left px-3 py-2 font-medium">Run ID</th>
                      <th className="text-left px-3 py-2 font-medium">市場</th>
                      <th className="text-right px-3 py-2 font-medium">Pending</th>
                      <th className="text-right px-3 py-2 font-medium">Published</th>
                      <th className="text-right px-3 py-2 font-medium">Failed</th>
                      <th className="text-right px-3 py-2 font-medium">LINE 推播</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runsQ.isLoading && (
                      <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">載入中…</td></tr>
                    )}
                    {!runsQ.isLoading && (runsQ.data ?? []).length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">近 14 天沒有執行紀錄。</td></tr>
                    )}
                    {(runsQ.data ?? []).map((r) => (
                      <tr key={r.run_id} className="border-t border-border/60">
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtDateTime(r.started_at)}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.run_id.slice(0, 8)}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className={marketTone(r.market)}>{r.market}</Badge>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.pending_found}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{r.published}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.failed > 0 ? <span className="text-red-600 font-semibold">{r.failed}</span> : '0'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {r.pushed}
                          {r.push_fail > 0 && <span className="text-red-600"> / 失 {r.push_fail}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Retry attempts */}
        <section>
          <div className="flex items-end justify-between mb-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground/80">自動重試佇列與歷史</h2>
              <p className="text-xs text-muted-foreground mt-1">
                每次批次呼叫都會在此留下紀錄。失敗或 timeout 會依 1/2/4/8/16 分鐘退避自動重試（最多 5 次，由每分鐘 watchdog 觸發）。
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => attemptsQ.refetch()}>
              <RefreshCw className="w-4 h-4 mr-1" /> 重新整理
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-foreground/70">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">建立時間</th>
                      <th className="text-left px-3 py-2 font-medium">市場</th>
                      <th className="text-left px-3 py-2 font-medium">狀態</th>
                      <th className="text-right px-3 py-2 font-medium">嘗試</th>
                      <th className="text-left px-3 py-2 font-medium">觸發</th>
                      <th className="text-left px-3 py-2 font-medium">下次重試</th>
                      <th className="text-right px-3 py-2 font-medium">耗時</th>
                      <th className="text-left px-3 py-2 font-medium">Run ID</th>
                      <th className="text-left px-3 py-2 font-medium">錯誤</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attemptsQ.isLoading && (
                      <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">載入中…</td></tr>
                    )}
                    {!attemptsQ.isLoading && (attemptsQ.data ?? []).length === 0 && (
                      <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">尚無重試紀錄。</td></tr>
                    )}
                    {(attemptsQ.data ?? []).map((a) => (
                      <tr key={a.id} className="border-t border-border/60 align-top">
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtDateTime(a.created_at)}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className={marketTone(a.market)}>{a.market}</Badge>
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className={attemptStatusTone(a.status)}>{attemptStatusLabel(a.status)}</Badge>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {a.attempt_no}<span className="text-muted-foreground">/{a.max_attempts}</span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{a.trigger_source || '—'}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {a.status === 'pending_retry' ? fmtDateTime(a.next_retry_at) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {a.duration_ms != null ? `${(a.duration_ms / 1000).toFixed(1)}s` : '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{a.run_id ? a.run_id.slice(0, 8) : '—'}</td>
                        <td className="px-3 py-2 max-w-[380px]">
                          {a.error_message ? (
                            <div className="text-xs text-red-700 line-clamp-2 break-words">{a.error_message}</div>
                          ) : (<span className="text-xs text-muted-foreground">—</span>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </CompanyLayout>
  );
}

function StatCard({
  label, value, tone,
}: { label: string; value: number; tone?: 'success' | 'warning' | 'danger' }) {
  const toneClass =
    tone === 'success' ? 'text-emerald-600' :
    tone === 'warning' ? 'text-orange-600' :
    tone === 'danger'  ? 'text-red-600' :
    'text-foreground';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function attemptStatusTone(s: AttemptRow['status']) {
  switch (s) {
    case 'succeeded': return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30';
    case 'running': return 'bg-blue-500/10 text-blue-700 border-blue-500/30';
    case 'pending_retry': return 'bg-amber-500/10 text-amber-700 border-amber-500/30';
    case 'failed': return 'bg-red-500/10 text-red-700 border-red-500/30';
    case 'exhausted': return 'bg-red-600/15 text-red-800 border-red-600/40';
    default: return 'bg-muted text-muted-foreground border-border';
  }
}
function attemptStatusLabel(s: AttemptRow['status']) {
  return ({
    succeeded: '成功',
    running: '執行中',
    pending_retry: '排入重試',
    failed: '失敗',
    exhausted: '重試耗盡',
  } as Record<string, string>)[s] || s;
}
