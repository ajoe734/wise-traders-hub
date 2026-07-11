// 串流健康度面板
//
// 讀 function_run_logs (fn='stream-metrics-report')，把 stream-metrics-report 落下的
// abort / timeout / error 事件列出來，可依 terminatedBy / eventCount / elapsedMs / source 篩選。
// RLS：company_admin 可 SELECT function_run_logs。
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SEO } from '@/components/SEO';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { Activity, RefreshCw } from 'lucide-react';

type TerminatedBy = 'abort' | 'timeout' | 'error' | 'all';

interface Row {
  id: string;
  created_at: string;
  run_id: string;
  stage: string | null;
  payload: {
    source?: string;
    terminatedBy?: string;
    eventCount?: number;
    elapsedMs?: number;
    contentType?: string;
    testName?: string;
    errorId?: string | null;
    extra?: Record<string, unknown> | null;
  };
}

const HOURS_OPTIONS = [1, 6, 24, 72];

export default function StreamHealth() {
  const [hours, setHours] = useState(24);
  const [terminated, setTerminated] = useState<TerminatedBy>('all');
  const [minEventCount, setMinEventCount] = useState<string>('');
  const [minElapsedMs, setMinElapsedMs] = useState<string>('');
  const [sourceQ, setSourceQ] = useState('');

  const since = useMemo(
    () => new Date(Date.now() - hours * 3600_000).toISOString(),
    [hours],
  );

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['stream-health', hours],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('function_run_logs')
        .select('id,created_at,run_id,stage,payload')
        .eq('fn', 'stream-metrics-report')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const rows: Row[] = data ?? [];

  const filtered = useMemo(() => {
    const minE = Number(minEventCount);
    const minMs = Number(minElapsedMs);
    const q = sourceQ.trim().toLowerCase();
    return rows.filter((r) => {
      const p = r.payload || {};
      if (terminated !== 'all' && p.terminatedBy !== terminated) return false;
      if (minEventCount !== '' && Number.isFinite(minE) && (p.eventCount ?? 0) < minE) return false;
      if (minElapsedMs !== '' && Number.isFinite(minMs) && (p.elapsedMs ?? 0) < minMs) return false;
      if (q && !(p.source ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, terminated, minEventCount, minElapsedMs, sourceQ]);

  // 統計
  const stats = useMemo(() => {
    const kinds: Record<string, number> = { abort: 0, timeout: 0, error: 0 };
    const eventCounts: number[] = [];
    const elapsed: number[] = [];
    for (const r of filtered) {
      const t = r.payload?.terminatedBy ?? '';
      if (t in kinds) kinds[t]++;
      if (typeof r.payload?.eventCount === 'number') eventCounts.push(r.payload.eventCount);
      if (typeof r.payload?.elapsedMs === 'number') elapsed.push(r.payload.elapsedMs);
    }
    const avg = (arr: number[]) =>
      arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    const max = (arr: number[]) => (arr.length ? Math.max(...arr) : 0);
    return {
      total: filtered.length,
      kinds,
      eventAvg: avg(eventCounts),
      eventMax: max(eventCounts),
      elapsedAvg: avg(elapsed),
      elapsedMax: max(elapsed),
    };
  }, [filtered]);

  const badgeVariant = (t?: string) => {
    switch (t) {
      case 'timeout':
        return 'destructive' as const;
      case 'error':
        return 'destructive' as const;
      case 'abort':
        return 'secondary' as const;
      default:
        return 'outline' as const;
    }
  };

  return (
    <CompanyLayout>
      <SEO title="串流健康度 | legendflow" description="AI 串流終止事件監控" path="/company/stream-health" noindex />

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5" />
          <div>
            <h1 className="text-[18px] font-medium tracking-tight">串流健康度</h1>
            <p className="text-[12px] text-foreground/55 mt-0.5">
              近 {hours} 小時內 AI 串流 abort / timeout / error 事件
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {HOURS_OPTIONS.map((h) => (
            <Button
              key={h}
              size="sm"
              variant={hours === h ? 'default' : 'outline'}
              onClick={() => setHours(h)}
            >
              {h}h
            </Button>
          ))}
          <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <SummaryCard label="總筆數" value={String(stats.total)} sub="符合篩選條件" />
        <SummaryCard label="abort" value={String(stats.kinds.abort)} sub="使用者中止" />
        <SummaryCard label="timeout" value={String(stats.kinds.timeout)} sub="watchdog 超時" />
        <SummaryCard label="eventCount avg / max" value={`${stats.eventAvg} / ${stats.eventMax}`} sub="chunk 數量" />
        <SummaryCard label="elapsedMs avg / max" value={`${stats.elapsedAvg} / ${stats.elapsedMax}`} sub="ms" />
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-[14px] font-medium">篩選</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <Label className="text-[11px]">terminatedBy</Label>
            <div className="flex gap-1 mt-1 flex-wrap">
              {(['all', 'abort', 'timeout', 'error'] as TerminatedBy[]).map((t) => (
                <Button
                  key={t}
                  size="sm"
                  variant={terminated === t ? 'default' : 'outline'}
                  onClick={() => setTerminated(t)}
                >
                  {t}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-[11px]">最少 eventCount</Label>
            <Input
              inputMode="numeric"
              className="mt-1 h-8"
              value={minEventCount}
              onChange={(e) => setMinEventCount(e.target.value.replace(/\D/g, ''))}
              placeholder="例如 5"
            />
          </div>
          <div>
            <Label className="text-[11px]">最少 elapsedMs</Label>
            <Input
              inputMode="numeric"
              className="mt-1 h-8"
              value={minElapsedMs}
              onChange={(e) => setMinElapsedMs(e.target.value.replace(/\D/g, ''))}
              placeholder="例如 3000"
            />
          </div>
          <div className="md:col-span-2">
            <Label className="text-[11px]">source 包含</Label>
            <Input
              className="mt-1 h-8"
              value={sourceQ}
              onChange={(e) => setSourceQ(e.target.value)}
              placeholder="例如 expert-ai-chat / integration_test"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-[14px] font-medium">明細（最多 500 筆）</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-foreground/55 border-b border-foreground/10">
                  <th className="py-2 pr-3">時間</th>
                  <th className="py-2 pr-3">terminatedBy</th>
                  <th className="py-2 pr-3 text-right">eventCount</th>
                  <th className="py-2 pr-3 text-right">elapsedMs</th>
                  <th className="py-2 pr-3">source</th>
                  <th className="py-2 pr-3">correlationId</th>
                  <th className="py-2 pr-3">errorId</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const p = r.payload || {};
                  return (
                    <tr key={r.id} className="border-b border-foreground/5 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-foreground/70">
                        {new Date(r.created_at).toLocaleString('zh-TW', { hour12: false })}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant={badgeVariant(p.terminatedBy)}>{p.terminatedBy ?? '—'}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{p.eventCount ?? '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{p.elapsedMs ?? '—'}</td>
                      <td className="py-2 pr-3 font-mono truncate max-w-[220px]" title={p.source}>
                        {p.source ?? '—'}
                      </td>
                      <td className="py-2 pr-3 font-mono text-[11px] text-foreground/60 truncate max-w-[180px]" title={r.run_id}>
                        {r.run_id}
                      </td>
                      <td className="py-2 pr-3 font-mono text-[11px] text-foreground/60 truncate max-w-[160px]" title={p.errorId ?? ''}>
                        {p.errorId ?? '—'}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-foreground/50">
                      {isFetching ? '載入中…' : '無符合條件的紀錄'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </CompanyLayout>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] text-foreground/55">{label}</div>
        <div className="text-[20px] font-medium tracking-tight mt-1 tabular-nums">{value}</div>
        {sub && <div className="text-[11px] text-foreground/45 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}
