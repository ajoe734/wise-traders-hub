import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { SEO } from '@/components/SEO';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, CheckCircle2, XCircle, AlertTriangle, Layers, Calendar, ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type PerStockAttempt = { date: string; error: string; error_class?: string | null };
type PerStock = {
  stock_id: string;
  ok: boolean;
  resolved_date: string | null;
  resolved_at_updated: boolean;
  mismatch_reason: string | null;
  final_reason: string;
  attempts: PerStockAttempt[];
  attempts_count: number;
  fallback: { source?: string; as_of_date?: string; rows?: number; lag_days?: number } | null;
  next_retry_at: string | null;
  next_retry_source: string | null;
  consec_before: number;
  lookback_from: string;
  lookback_to: string;
};

type JobRow = {
  id: string;
  job_name: string;
  status: string;
  ran_at: string;
  detail: {
    mode?: string;
    date?: string;
    lookback?: number;
    lookback_window?: { from: string; to: string } | null;
    batch?: number;
    processed?: number;
    success?: number;
    failed?: number;
    recovered_last_successful_count?: number;
    recovered_stocks?: Array<{ stock_id: string; resolved_date: string; consec_before: number }>;
    fallback_range?: { min: string; max: string } | null;
    covered_dates?: string[];
    config_version?: number | string;
    per_stock?: PerStock[];
  } | null;
};


const fmtDT = (s: string | null | undefined) => {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const fmtD = (s: string | null | undefined) => (s ? s.replace(/-/g, '/') : '—');

const statusColor = (s: string) =>
  s === 'success' ? { bg: '#ECFDF5', fg: '#065F46' }
  : s === 'partial' ? { bg: '#FEF3C7', fg: '#92400E' }
  : s === 'failed' ? { bg: '#FEE2E2', fg: '#991B1B' }
  : { bg: 'hsl(var(--foreground) / 0.05)', fg: 'hsl(var(--foreground) / 0.7)' };

export default function BsrBackfillProgressPage() {
  const [mode, setMode] = useState<'backfill' | 'all' | 'scheduled' | 'manual'>('backfill');
  const [limit, setLimit] = useState<number>(50);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery<JobRow[]>({
    queryKey: ['bsr-backfill-progress', mode, limit],
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase
        .from('system_jobs_log')
        .select('id, job_name, status, ran_at, detail')
        .order('ran_at', { ascending: false })
        .limit(limit);
      if (mode === 'all') q = q.like('job_name', 'tw-bsr-%');
      else q = q.eq('job_name', `tw-bsr-${mode}`);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as JobRow[];
    },
  });

  const kpi = useMemo(() => {
    if (!data) return null;
    let processed = 0, success = 0, failed = 0, recovered = 0;
    let minDate = '', maxDate = '';
    for (const r of data) {
      const d = r.detail || {};
      processed += Number(d.processed || 0);
      success += Number(d.success || 0);
      failed += Number(d.failed || 0);
      recovered += Number(d.recovered_last_successful_count || 0);
      if (d.fallback_range?.min) minDate = !minDate || d.fallback_range.min < minDate ? d.fallback_range.min : minDate;
      if (d.fallback_range?.max) maxDate = !maxDate || d.fallback_range.max > maxDate ? d.fallback_range.max : maxDate;
    }
    return { runs: data.length, processed, success, failed, recovered, minDate, maxDate };
  }, [data]);

  return (
    <CompanyLayout>
      <SEO title="BSR Backfill 進度｜Legendflow 後台" description="逐輪追蹤 BSR 回補 cron 的完成/失敗、fallback 日期覆蓋範圍與 last_successful 恢復狀態" />
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[22px] font-medium tracking-tight text-foreground">BSR Backfill 進度</h1>
            <p className="text-[13px] text-foreground/60 mt-1">
              追蹤每一輪 cron 執行的完成/失敗數、本輪回補覆蓋的 fallback 日期範圍，以及本輪是否已恢復 last_successful
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={mode} onValueChange={(v: any) => setMode(v)}>
              <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="backfill">Backfill</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="all">全部 BSR</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(limit)} onValueChange={(v) => setLimit(parseInt(v, 10))}>
              <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="20">近 20 輪</SelectItem>
                <SelectItem value="50">近 50 輪</SelectItem>
                <SelectItem value="100">近 100 輪</SelectItem>
                <SelectItem value="200">近 200 輪</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />重新整理
            </Button>
          </div>
        </div>

        {/* KPI 卡 */}
        {kpi && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <KpiCard icon={<Layers className="h-4 w-4" />} label="輪次" value={kpi.runs} />
            <KpiCard icon={<Layers className="h-4 w-4" />} label="累計處理" value={kpi.processed} />
            <KpiCard icon={<CheckCircle2 className="h-4 w-4" />} label="成功" value={kpi.success} tone="ok" />
            <KpiCard icon={<XCircle className="h-4 w-4" />} label="失敗" value={kpi.failed} tone="err" />
            <KpiCard icon={<CheckCircle2 className="h-4 w-4" />} label="恢復 last_successful" value={kpi.recovered} tone="warn" />
            <KpiCard
              icon={<Calendar className="h-4 w-4" />}
              label="Fallback 日期覆蓋"
              value={kpi.minDate && kpi.maxDate ? (kpi.minDate === kpi.maxDate ? fmtD(kpi.minDate) : `${fmtD(kpi.minDate)} – ${fmtD(kpi.maxDate)}`) : '—'}
            />
          </div>
        )}

        {/* 逐輪列表 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px] font-medium">逐輪執行紀錄</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && <div className="text-sm text-foreground/60 py-8 text-center">載入中…</div>}
            {error && <div className="text-sm text-red-600 py-4">讀取失敗：{(error as Error).message}</div>}
            {!isLoading && data && data.length === 0 && (
              <div className="text-sm text-foreground/60 py-8 text-center">尚無紀錄</div>
            )}
            {data && data.length > 0 && (
              <div className="divide-y">
                {data.map((row) => {
                  const d = row.detail || {};
                  const c = statusColor(row.status);
                  const isOpen = expanded === row.id;
                  const range = d.fallback_range;
                  return (
                    <div key={row.id} className="py-3">
                      <button
                        type="button"
                        className="w-full flex items-center gap-3 text-left"
                        onClick={() => setExpanded(isOpen ? null : row.id)}
                      >
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-foreground/50" /> : <ChevronRight className="h-3.5 w-3.5 text-foreground/50" />}
                        <div className="w-40 tabular-nums text-[12px] text-foreground/70">{fmtDT(row.ran_at)}</div>
                        <Badge variant="outline" style={{ background: c.bg, color: c.fg, borderColor: 'transparent' }} className="text-[10px] uppercase">
                          {row.status}
                        </Badge>
                        <div className="text-[12px] text-foreground/80 font-mono">{row.job_name}</div>
                        <div className="ml-auto flex items-center gap-4 text-[12px] tabular-nums">
                          <span title="processed / success / failed" className="text-foreground/60">
                            <span className="text-foreground/80">{d.processed ?? 0}</span>
                            <span className="text-emerald-700 mx-1">✓{d.success ?? 0}</span>
                            <span className="text-red-700">✗{d.failed ?? 0}</span>
                          </span>
                          {Number(d.recovered_last_successful_count || 0) > 0 && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: '#FEF3C7', color: '#92400E' }}>
                              <CheckCircle2 className="inline h-3 w-3 mr-0.5" />
                              恢復 {d.recovered_last_successful_count}
                            </span>
                          )}
                          {range && (
                            <span className="text-[11px] text-foreground/60">
                              <Calendar className="inline h-3 w-3 mr-0.5" />
                              {range.min === range.max ? fmtD(range.min) : `${fmtD(range.min)} – ${fmtD(range.max)}`}
                            </span>
                          )}
                        </div>
                      </button>

                      {isOpen && (
                        <div className="mt-3 ml-6 grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
                          <div className="p-3 rounded border">
                            <div className="text-foreground/60 mb-2">執行參數</div>
                            <div className="grid grid-cols-2 gap-y-1">
                              <span className="text-foreground/60">mode</span><span className="tabular-nums">{d.mode || '—'}</span>
                              <span className="text-foreground/60">目標日</span><span className="tabular-nums">{fmtD(d.date)}</span>
                              <span className="text-foreground/60">lookback</span><span className="tabular-nums">{d.lookback ?? '—'}</span>
                              <span className="text-foreground/60">lookback 視窗</span>
                              <span className="tabular-nums">
                                {d.lookback_window ? `${fmtD(d.lookback_window.from)} – ${fmtD(d.lookback_window.to)}` : '—'}
                              </span>
                              <span className="text-foreground/60">batch</span><span className="tabular-nums">{d.batch ?? '—'}</span>
                              <span className="text-foreground/60">run_id</span><span className="font-mono text-[10px] break-all">{row.id}</span>
                              <span className="text-foreground/60">config_version</span><span className="tabular-nums">v{d.config_version ?? '—'}</span>

                            </div>
                          </div>
                          <div className="p-3 rounded border">
                            <div className="text-foreground/60 mb-2 flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              本輪覆蓋日期
                            </div>
                            {(d.covered_dates && d.covered_dates.length > 0) ? (
                              <div className="flex flex-wrap gap-1">
                                {d.covered_dates.map((cd) => (
                                  <Badge key={cd} variant="outline" className="text-[10px] tabular-nums">{fmtD(cd)}</Badge>
                                ))}
                              </div>
                            ) : (
                              <div className="text-foreground/50">未覆蓋任何 fallback 日期</div>
                            )}
                          </div>
                          <div className="p-3 rounded border md:col-span-2">
                            <div className="text-foreground/60 mb-2 flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              本輪恢復 last_successful 的股票
                              <span className="text-[10px] text-foreground/40 ml-1">
                                （先前 consecutive_failures &gt; 0、本輪抓取成功）
                              </span>
                            </div>
                            {(d.recovered_stocks && d.recovered_stocks.length > 0) ? (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                                {d.recovered_stocks.map((s) => (
                                  <div key={s.stock_id} className="flex items-center gap-2 py-1 px-2 rounded" style={{ background: 'hsl(var(--foreground) / 0.03)' }}>
                                    <span className="font-mono text-foreground/80">{s.stock_id}</span>
                                    <span className="text-foreground/60">→ {fmtD(s.resolved_date)}</span>
                                    <span className="ml-auto text-[10px] text-foreground/50">先前連續失敗 {s.consec_before} 次</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-foreground/50 flex items-center gap-2">
                                <AlertTriangle className="h-3 w-3" />
                                本輪沒有股票從失敗狀態恢復
                              </div>
                            )}
                          </div>
                          <div className="md:col-span-2">
                            <PerStockDetail perStock={d.per_stock || []} />
                          </div>
                        </div>
                      )}
                    </div>

                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
}

function KpiCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: 'ok' | 'err' | 'warn' }) {
  const color = tone === 'ok' ? '#065F46' : tone === 'err' ? '#991B1B' : tone === 'warn' ? '#92400E' : 'hsl(var(--foreground))';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-[11px] text-foreground/60">
          {icon}
          {label}
        </div>
        <div className="mt-1 text-[20px] font-medium tabular-nums" style={{ color }}>{value}</div>
      </CardContent>
    </Card>
  );
}

function PerStockDetail({ perStock }: { perStock: PerStock[] }) {
  const [filter, setFilter] = useState<'all' | 'ok' | 'fail' | 'recovered' | 'fallback'>('all');
  const [openStock, setOpenStock] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!perStock || perStock.length === 0) return [];
    switch (filter) {
      case 'ok': return perStock.filter((s) => s.ok);
      case 'fail': return perStock.filter((s) => !s.ok);
      case 'recovered': return perStock.filter((s) => s.ok && s.resolved_at_updated);
      case 'fallback': return perStock.filter((s) => !s.ok && !!s.fallback);
      default: return perStock;
    }
  }, [perStock, filter]);

  const counts = useMemo(() => ({
    all: perStock.length,
    ok: perStock.filter((s) => s.ok).length,
    fail: perStock.filter((s) => !s.ok).length,
    recovered: perStock.filter((s) => s.ok && s.resolved_at_updated).length,
    fallback: perStock.filter((s) => !s.ok && !!s.fallback).length,
  }), [perStock]);

  if (!perStock || perStock.length === 0) {
    return (
      <div className="p-3 rounded border text-[12px] text-foreground/50">
        本輪未載入逐檔明細（可能為舊版執行，尚無 per_stock 欄位）。新一輪 sync 後即可看到。
      </div>
    );
  }

  const chip = (k: typeof filter, label: string, n: number) => (
    <button
      key={k}
      type="button"
      onClick={() => setFilter(k)}
      className={`px-2 py-0.5 rounded text-[11px] tabular-nums transition ${filter === k ? 'bg-foreground text-background' : 'bg-foreground/5 text-foreground/70 hover:bg-foreground/10'}`}
    >
      {label} <span className="opacity-70">{n}</span>
    </button>
  );

  return (
    <div className="p-3 rounded border">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div className="text-foreground/60 text-[12px] flex items-center gap-1">
          <Layers className="h-3 w-3" /> 逐檔 Backfill 明細
          <span className="text-[10px] text-foreground/40 ml-1">
            （點展開查看每次 lookback 嘗試與 mismatch_reason）
          </span>
        </div>
        <div className="flex items-center gap-1">
          {chip('all', '全部', counts.all)}
          {chip('ok', '成功', counts.ok)}
          {chip('recovered', '恢復', counts.recovered)}
          {chip('fail', '失敗', counts.fail)}
          {chip('fallback', 'Fallback', counts.fallback)}
        </div>
      </div>

      <div className="divide-y">
        {filtered.map((s) => {
          const isOpen = openStock === s.stock_id;
          const badgeStyle = s.ok
            ? { bg: '#ECFDF5', fg: '#065F46', text: 'success' }
            : s.fallback
              ? { bg: '#FEF3C7', fg: '#92400E', text: 'fallback' }
              : { bg: '#FEE2E2', fg: '#991B1B', text: s.final_reason };
          return (
            <div key={s.stock_id} className="py-2">
              <button
                type="button"
                className="w-full flex items-center gap-2 text-left text-[12px]"
                onClick={() => setOpenStock(isOpen ? null : s.stock_id)}
              >
                {isOpen ? <ChevronDown className="h-3 w-3 text-foreground/40" /> : <ChevronRight className="h-3 w-3 text-foreground/40" />}
                <span className="font-mono text-foreground/80 w-16 tabular-nums">{s.stock_id}</span>
                <Badge variant="outline" style={{ background: badgeStyle.bg, color: badgeStyle.fg, borderColor: 'transparent' }} className="text-[10px]">
                  {badgeStyle.text}
                </Badge>
                <span className="text-foreground/60 tabular-nums">
                  {fmtD(s.lookback_from)} → {fmtD(s.lookback_to)}
                </span>
                <span className="text-foreground/60">·</span>
                <span className="text-foreground/60">嘗試 {s.attempts_count}</span>
                {s.resolved_date && (
                  <span className="text-emerald-700 text-[11px]">
                    resolved_at → {fmtD(s.resolved_date)}
                  </span>
                )}
                {s.resolved_at_updated && (
                  <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: '#FEF3C7', color: '#92400E' }}>
                    本輪恢復
                  </span>
                )}
                {!s.ok && s.mismatch_reason && (
                  <span className="ml-auto text-[11px] text-red-700 font-mono">{s.mismatch_reason}</span>
                )}
              </button>

              {isOpen && (
                <div className="mt-2 ml-5 grid grid-cols-1 gap-2 text-[11px]">
                  <div className="grid grid-cols-[80px_1fr] gap-y-1">
                    <span className="text-foreground/60">final_reason</span>
                    <span className="font-mono">{s.final_reason}</span>
                    <span className="text-foreground/60">consec_before</span>
                    <span className="tabular-nums">{s.consec_before}</span>
                    {s.fallback && (
                      <>
                        <span className="text-foreground/60">fallback</span>
                        <span className="tabular-nums">
                          {s.fallback.source} · {fmtD(s.fallback.as_of_date)} · {s.fallback.rows} rows · lag {s.fallback.lag_days}d
                        </span>
                      </>
                    )}
                    {s.next_retry_at && (
                      <>
                        <span className="text-foreground/60">next_retry</span>
                        <span className="tabular-nums">{fmtDT(s.next_retry_at)}</span>
                        <span className="text-foreground/60">retry_source</span>
                        <span className="font-mono text-[10px] break-all">{s.next_retry_source}</span>
                      </>
                    )}
                  </div>

                  <div className="mt-1">
                    <div className="text-foreground/60 mb-1">逐次 lookback 嘗試</div>
                    {s.attempts.length === 0 ? (
                      <div className="text-foreground/40">首次即命中或未進入 lookback 迴圈</div>
                    ) : (
                      <div className="border rounded overflow-hidden">
                        <table className="w-full text-[11px]">
                          <thead className="bg-foreground/5 text-foreground/60">
                            <tr>
                              <th className="text-left px-2 py-1 w-8">#</th>
                              <th className="text-left px-2 py-1 w-24">cursor 日期</th>
                              <th className="text-left px-2 py-1 w-32">error_class</th>
                              <th className="text-left px-2 py-1">error / mismatch_reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.attempts.map((a, i) => (
                              <tr key={`${a.date}-${i}`} className="border-t">
                                <td className="px-2 py-1 tabular-nums text-foreground/60">{i + 1}</td>
                                <td className="px-2 py-1 tabular-nums">{fmtD(a.date)}</td>
                                <td className="px-2 py-1 font-mono text-red-700">{a.error_class || '—'}</td>
                                <td className="px-2 py-1 font-mono text-foreground/70 break-all">{a.error}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="py-4 text-center text-foreground/50 text-[12px]">此篩選條件下沒有明細</div>
        )}
      </div>
    </div>
  );
}

