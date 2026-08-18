import { functionUrl } from "@/lib/supabaseEndpoint";
import { SEO } from '@/components/SEO';
import { useMemo, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, Search, Clock, ShieldAlert, LifeBuoy, Timer } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

type Attempt = {
  id: number;
  stock_id: string;
  trade_date: string;
  attempted_at: string;
  ua_label: string | null;
  ua_hash: string | null;
  backoff_seconds_before: number | null;
  consecutive_failures_before: number | null;
  ocr_mode: string | null;
  latency_ms: number | null;
  outcome: string;
  attempt_step: number | null;
  config_version: string | null;
  http_status: number | null;
  error: string | null;
  fallback_used: boolean;
  fallback_as_of_date: string | null;
  next_retry_at: string | null;
  next_retry_source: string | null;
};

type FailureRow = {
  trade_date: string;
  reason: string | null;
  attempts: number | null;
  consecutive_failures: number | null;
  backoff_seconds: number | null;
  next_retry_at: string | null;
  resolved_at: string | null;
  last_error: string | null;
  updated_at: string;
};

type TimelineResp = {
  summary: {
    stock_id: string;
    window_days: number;
    total_attempts: number;
    success: number;
    captcha_exhausted: number;
    http_block: number;
    empty: number;
    other_fail: number;
    finalized_with_fallback: number;
    last_successful_as_of: string | null;
    generated_at: string;
  };
  attempts: Attempt[];
  failures: FailureRow[];
};

const fmtTime = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}/${m}/${day} ${hh}:${mm}:${ss}`;
};

const outcomeBadge = (o: string) => {
  if (o === 'success') return <Badge className="bg-emerald-600 hover:bg-emerald-600">success</Badge>;
  if (o.startsWith('finalized:')) return <Badge variant="outline" className="border-amber-500 text-amber-700">{o}</Badge>;
  if (o === 'http_block') return <Badge variant="destructive">http_block</Badge>;
  if (o === 'captcha_retry_exhausted') return <Badge className="bg-orange-500 hover:bg-orange-500">captcha_exhausted</Badge>;
  if (o === 'empty_rows') return <Badge variant="secondary">empty_rows</Badge>;
  return <Badge variant="outline">{o}</Badge>;
};

const httpBadge = (s: number | null) => {
  if (s == null) return <span className="text-muted-foreground">—</span>;
  const cls = s === 200 ? 'text-emerald-600'
    : s === 429 ? 'text-red-600'
    : s === 403 ? 'text-red-600'
    : s >= 500 ? 'text-orange-600'
    : 'text-foreground';
  return <span className={`font-mono ${cls}`}>{s}</span>;
};

export default function BsrStockTimeline() {
  const [stockInput, setStockInput] = useState('');
  const [stockId, setStockId] = useState('');
  const [days, setDays] = useState(14);

  const { data, isLoading, error, refetch, isFetching } = useQuery<TimelineResp>({
    queryKey: ['bsr-stock-timeline', stockId, days],
    enabled: !!stockId,
    staleTime: 30_000,
    queryFn: async () => {
      const qs = new URLSearchParams({ stock_id: stockId, days: String(days) });
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const url = `${functionUrl("tw-bsr-stock-timeline")}?${qs.toString()}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const submit = () => {
    const s = stockInput.trim();
    if (!/^[0-9]{4,6}$/.test(s)) {
      toast.error('請輸入 4-6 碼股票代號');
      return;
    }
    setStockId(s);
  };

  const summary = data?.summary;
  const attempts = data?.attempts || [];
  const failures = data?.failures || [];

  const groupedByDate = useMemo(() => {
    const m = new Map<string, Attempt[]>();
    for (const a of attempts) {
      const k = a.trade_date;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(a);
    }
    return Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [attempts]);

  return (
    <CompanyLayout>
      <SEO title="BSR 逐檔時間軸｜legendflow" description="逐檔 BSR 抓取歷程、HTTP 狀態、fallback 與 next_retry 推算。" />

      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-sm text-muted-foreground">股票代號</label>
            <Input
              value={stockInput}
              onChange={(e) => setStockInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="2330"
              className="w-40"
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">回看天數</label>
            <Input
              type="number"
              min={1}
              max={60}
              value={days}
              onChange={(e) => setDays(Math.min(60, Math.max(1, Number(e.target.value) || 14)))}
              className="w-28"
            />
          </div>
          <Button onClick={submit}><Search className="mr-1 h-4 w-4" />查詢</Button>
          {stockId && (
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`mr-1 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />重新載入
            </Button>
          )}
        </div>

        {error && <div className="text-sm text-destructive">載入失敗：{(error as Error).message}</div>}

        {summary && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            <Card><CardContent className="p-3">
              <div className="text-xs text-muted-foreground">Attempts</div>
              <div className="text-xl font-semibold">{summary.total_attempts}</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-xs text-muted-foreground">Success</div>
              <div className="text-xl font-semibold text-emerald-600">{summary.success}</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-xs text-muted-foreground">Captcha exhausted</div>
              <div className="text-xl font-semibold text-orange-600">{summary.captcha_exhausted}</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-xs text-muted-foreground">HTTP block</div>
              <div className="text-xl font-semibold text-red-600">{summary.http_block}</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-xs text-muted-foreground">用 fallback 收尾</div>
              <div className="text-xl font-semibold text-amber-600">{summary.finalized_with_fallback}</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-xs text-muted-foreground">最近成功 as_of</div>
              <div className="text-base font-mono">{summary.last_successful_as_of || '—'}</div>
            </CardContent></Card>
          </div>
        )}

        {failures.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="h-4 w-4" />目前失敗狀態（tw_bsr_fetch_failures）
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-3">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="p-2 text-left">trade_date</th>
                    <th className="p-2 text-left">reason</th>
                    <th className="p-2 text-right">attempts</th>
                    <th className="p-2 text-right">consec</th>
                    <th className="p-2 text-right">backoff (s)</th>
                    <th className="p-2 text-left">next_retry_at</th>
                    <th className="p-2 text-left">resolved_at</th>
                    <th className="p-2 text-left">updated_at</th>
                    <th className="p-2 text-left">last_error</th>
                  </tr>
                </thead>
                <tbody>
                  {failures.map((f, i) => (
                    <tr key={i} className="border-b">
                      <td className="p-2 font-mono">{f.trade_date}</td>
                      <td className="p-2">{f.reason || '—'}</td>
                      <td className="p-2 text-right">{f.attempts ?? '—'}</td>
                      <td className="p-2 text-right">{f.consecutive_failures ?? '—'}</td>
                      <td className="p-2 text-right">{f.backoff_seconds ?? '—'}</td>
                      <td className="p-2 font-mono">{fmtTime(f.next_retry_at)}</td>
                      <td className="p-2 font-mono">{f.resolved_at ? fmtTime(f.resolved_at) : <span className="text-red-600">未解</span>}</td>
                      <td className="p-2 font-mono">{fmtTime(f.updated_at)}</td>
                      <td className="p-2 text-muted-foreground">{f.last_error || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {isLoading && <div className="text-sm text-muted-foreground">載入中…</div>}

        {stockId && !isLoading && groupedByDate.length === 0 && (
          <div className="text-sm text-muted-foreground">此區間無 attempt 紀錄。</div>
        )}

        {groupedByDate.map(([date, rows]) => (
          <Card key={date}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4" />trade_date {date}
                <Badge variant="outline">{rows.length} attempts</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-3">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="p-2 text-left">attempted_at</th>
                    <th className="p-2 text-center">step</th>
                    <th className="p-2 text-left">outcome</th>
                    <th className="p-2 text-center">HTTP</th>
                    <th className="p-2 text-right">latency</th>
                    <th className="p-2 text-left">UA</th>
                    <th className="p-2 text-right">backoff/consec</th>
                    <th className="p-2 text-left">ocr</th>
                    <th className="p-2 text-left">fallback</th>
                    <th className="p-2 text-left">next_retry_at</th>
                    <th className="p-2 text-left">next_retry_source</th>
                    <th className="p-2 text-left">error</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id} className={`border-b ${a.attempt_step === 99 ? 'bg-amber-50' : ''}`}>
                      <td className="p-2 font-mono whitespace-nowrap">{fmtTime(a.attempted_at)}</td>
                      <td className="p-2 text-center">
                        {a.attempt_step === 99
                          ? <Badge variant="outline" className="border-amber-500 text-amber-700">final</Badge>
                          : (a.attempt_step ?? '—')}
                      </td>
                      <td className="p-2">{outcomeBadge(a.outcome)}</td>
                      <td className="p-2 text-center">{httpBadge(a.http_status)}</td>
                      <td className="p-2 text-right font-mono">{a.latency_ms ?? '—'}ms</td>
                      <td className="p-2">
                        <div>{a.ua_label || '—'}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{a.ua_hash || ''}</div>
                      </td>
                      <td className="p-2 text-right font-mono">
                        {a.backoff_seconds_before ?? 0}s / {a.consecutive_failures_before ?? 0}
                      </td>
                      <td className="p-2">{a.ocr_mode || '—'}</td>
                      <td className="p-2">
                        {a.fallback_used
                          ? <span className="inline-flex items-center gap-1 text-amber-700">
                              <LifeBuoy className="h-3 w-3" />
                              <span className="font-mono">{a.fallback_as_of_date || 'used'}</span>
                            </span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="p-2 font-mono">{fmtTime(a.next_retry_at)}</td>
                      <td className="p-2">
                        {a.next_retry_source
                          ? <span className="inline-flex items-center gap-1 text-muted-foreground">
                              <Timer className="h-3 w-3" />
                              <span className="font-mono text-[11px]">{a.next_retry_source}</span>
                            </span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="p-2 text-muted-foreground max-w-[280px] truncate" title={a.error || ''}>{a.error || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))}
      </div>
    </CompanyLayout>
  );
}
