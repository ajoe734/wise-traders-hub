import { SEO } from '@/components/SEO';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, PlayCircle, ListPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

type DegradeMode = 'normal' | 'tier3_paused' | 'tier2_paused' | 'p1_only' | 'claim_halt';
type Stats = {
  ok: boolean;
  generated_at: string;
  rate_limit: { used: number; remaining: number; allowed: boolean; limit: number };
  limit_config: { hourly_limit: number };
  queue_depth: Record<string, { pending?: number; running?: number }>;
  last_24h: { total_calls: number; errors: number; r429: number; success_rate: number | null };
  hourly_last_24h: Record<string, { calls: number; success: number; error: number; r429: number }>;
  queue_latency_ms: Record<string, { count: number; p50_ms: number; p95_ms: number; max_ms: number }>;
  reservations?: {
    in_flight: number;
    expiring_soon: number;
    expired_unsettled: number;
    settled_last_hour: number;
    rate_limited_last_hour: number;
    oldest_in_flight_age_seconds: number;
  };
  p1_oldest_pending_age_seconds?: number;
  rate_limited_streak_minutes?: number;
  degrade?: {
    mode: DegradeMode;
    since: string | null;
    reason: string | null;
    trigger_metric: string | null;
    trigger_value: number | null;
    last_transition_at: string | null;
    cooldown_until: string | null;
    policy: { max_priority: number; concurrency: number; allow_claim: boolean; allow_enqueue_tier3: boolean };
    recent_transitions: Array<{
      id: number; from_mode: string; to_mode: string; reason: string;
      trigger_metric: string | null; trigger_value: number | null; threshold: number | null;
      created_at: string;
    }>;
  };
};

const MODE_LABEL: Record<DegradeMode, { label: string; tone: string }> = {
  normal:       { label: '正常',       tone: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  tier3_paused: { label: 'Tier3 暫停', tone: 'bg-amber-100  text-amber-800  border-amber-300'  },
  tier2_paused: { label: 'Tier2 暫停', tone: 'bg-orange-100 text-orange-800 border-orange-300' },
  p1_only:      { label: '僅 P1',      tone: 'bg-red-100    text-red-800    border-red-300'    },
  claim_halt:   { label: 'Claim 停手', tone: 'bg-neutral-900 text-neutral-50 border-neutral-800' },
};

async function callSync(body: unknown): Promise<Stats | any> {
  const { data, error } = await supabase.functions.invoke('tw-bsr-finmind-sync', { body });
  if (error) throw new Error(error.message);
  return data;
}

export default function BsrRateLimit() {
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isFetching, refetch } = useQuery<Stats>({
    queryKey: ['company', 'bsr-rate-limit-stats'],
    queryFn: () => callSync({ mode: 'stats' }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const runAction = async (label: string, body: unknown) => {
    setBusy(label);
    try {
      const res = await callSync(body);
      toast.success(`${label}：${JSON.stringify(res).slice(0, 180)}`);
      await refetch();
    } catch (e) {
      toast.error(`${label} 失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const usagePct = data ? Math.round((data.rate_limit.used / data.rate_limit.limit) * 100) : 0;

  return (
    <CompanyLayout>
      <SEO title="BSR 限流與佇列監控 | legendflow" description="FinMind BSR 抓取器的限流用量、佇列深度、成功率與延遲。" path="/company/bsr-rate-limit" noindex />
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">BSR 限流 / 佇列監控</h1>
            <p className="text-sm text-muted-foreground mt-1">
              FinMind API 每小時上限 {data?.limit_config.hourly_limit ?? 1500} 次；三層優先級佇列（1=持倉 / 2=缺口 / 3=回填）。
            </p>
          </div>
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> 重新整理
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">過去 60 分鐘用量</div>
            <div className="text-2xl font-semibold mt-1">
              {data?.rate_limit.used ?? '—'}
              <span className="text-sm text-muted-foreground ml-1">/ {data?.rate_limit.limit ?? '—'}</span>
            </div>
            <div className="h-2 bg-muted rounded mt-2 overflow-hidden">
              <div
                className={`h-full ${usagePct > 90 ? 'bg-destructive' : usagePct > 70 ? 'bg-yellow-500' : 'bg-primary'}`}
                style={{ width: `${Math.min(100, usagePct)}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-1">剩餘 {data?.rate_limit.remaining ?? '—'}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">24h 呼叫數</div>
            <div className="text-2xl font-semibold mt-1">{data?.last_24h.total_calls ?? '—'}</div>
            <div className="text-xs text-muted-foreground mt-2">錯誤 {data?.last_24h.errors ?? '—'} · 429 {data?.last_24h.r429 ?? '—'}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">24h 成功率</div>
            <div className="text-2xl font-semibold mt-1">
              {data?.last_24h.success_rate != null ? `${data.last_24h.success_rate}%` : '—'}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Queue 深度</div>
            <div className="mt-1 flex gap-2 flex-wrap">
              {(['p1', 'p2', 'p3'] as const).map((k) => (
                <Badge key={k} variant="secondary" className="font-mono">
                  {k.toUpperCase()} pending {data?.queue_depth?.[k]?.pending ?? 0} · run {data?.queue_depth?.[k]?.running ?? 0}
                </Badge>
              ))}
            </div>
          </Card>
        </div>

        <Card className="p-4">
          <div className="text-sm font-medium mb-2">Reservation / 佇列健康度</div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground">In-flight</div>
              <div className="text-lg font-semibold font-mono">{data?.reservations?.in_flight ?? '—'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">10s 內到期</div>
              <div className="text-lg font-semibold font-mono">{data?.reservations?.expiring_soon ?? '—'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">過期未結算</div>
              <div className={`text-lg font-semibold font-mono ${(data?.reservations?.expired_unsettled ?? 0) > 0 ? 'text-destructive' : ''}`}>
                {data?.reservations?.expired_unsettled ?? '—'}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">最舊 in-flight 年齡</div>
              <div className={`text-lg font-semibold font-mono ${(data?.reservations?.oldest_in_flight_age_seconds ?? 0) >= 60 ? 'text-destructive' : ''}`}>
                {data?.reservations?.oldest_in_flight_age_seconds ?? 0}s
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">近 1h 429 連續分鐘</div>
              <div className={`text-lg font-semibold font-mono ${(data?.rate_limited_streak_minutes ?? 0) >= 3 ? 'text-amber-600' : ''}`}>
                {data?.rate_limited_streak_minutes ?? 0}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">P1 最舊 pending</div>
              <div className={`text-lg font-semibold font-mono ${(data?.p1_oldest_pending_age_seconds ?? 0) >= 1800 ? 'text-destructive' : ''}`}>
                {Math.round((data?.p1_oldest_pending_age_seconds ?? 0) / 60)} 分
              </div>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            過期未結算 &gt; 0 由 cron <span className="font-mono">tw-bsr-purge-expired-reservations</span>（*/5 * * * *）自動回收；
            告警閾值：用量 ≥80%、最舊 in-flight ≥60s、429 連續 ≥3 分鐘、P1 pending ≥30 分。
          </p>
        </Card>


        <Card className="p-4">
          <div className="text-sm font-medium mb-2">手動操作</div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" disabled={!!busy} className="gap-2"
              onClick={() => runAction('入列（tier1+tier2）', { mode: 'enqueue', tier1: true, tier2: true })}>
              <ListPlus className="h-4 w-4" /> 立即入列（今日）
            </Button>
            <Button size="sm" variant="outline" disabled={!!busy} className="gap-2"
              onClick={() => runAction('入列（tier3 回填 5 日）', { mode: 'enqueue', tier1: false, tier2: false, tier3: true, backfill_days: 5 })}>
              <ListPlus className="h-4 w-4" /> 回填持倉股 5 日
            </Button>
            <Button size="sm" variant="outline" disabled={!!busy} className="gap-2"
              onClick={() => runAction('worker（P1 only）', { mode: 'worker', batch: 30, max_priority: 1, budget_ms: 45000 })}>
              <PlayCircle className="h-4 w-4" /> 執行 worker（僅 P1）
            </Button>
            <Button size="sm" variant="outline" disabled={!!busy} className="gap-2"
              onClick={() => runAction('worker（全優先級）', { mode: 'worker', batch: 30, max_priority: 3, budget_ms: 45000 })}>
              <PlayCircle className="h-4 w-4" /> 執行 worker（全部）
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-sm font-medium mb-2">最近 24 小時每小時分布</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <th className="p-2 text-left">小時</th>
                  <th className="p-2 text-right">呼叫</th>
                  <th className="p-2 text-right">成功</th>
                  <th className="p-2 text-right">錯誤</th>
                  <th className="p-2 text-right">429</th>
                  <th className="p-2 text-right">使用率</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data?.hourly_last_24h ?? {})
                  .sort((a, b) => (a[0] < b[0] ? 1 : -1))
                  .map(([hr, v]) => {
                    const pct = Math.round((v.calls / (data?.limit_config.hourly_limit ?? 1500)) * 100);
                    return (
                      <tr key={hr} className="border-t">
                        <td className="p-2 font-mono">{hr.replace('T', ' ')}</td>
                        <td className="p-2 text-right font-mono">{v.calls}</td>
                        <td className="p-2 text-right font-mono">{v.success}</td>
                        <td className="p-2 text-right font-mono text-destructive">{v.error || ''}</td>
                        <td className="p-2 text-right font-mono text-amber-600">{v.r429 || ''}</td>
                        <td className="p-2 text-right font-mono">{pct}%</td>
                      </tr>
                    );
                  })}
                {!Object.keys(data?.hourly_last_24h ?? {}).length && (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">尚無資料</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-sm font-medium mb-2">各優先級延遲（enqueued → done，24h）</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(['p1', 'p2', 'p3'] as const).map((k) => {
              const v = data?.queue_latency_ms?.[k];
              return (
                <div key={k} className="border rounded p-3">
                  <div className="text-xs font-medium">{k.toUpperCase()}</div>
                  {v ? (
                    <div className="text-xs text-muted-foreground mt-1 space-y-0.5 font-mono">
                      <div>樣本 {v.count}</div>
                      <div>p50 {(v.p50_ms / 1000).toFixed(1)}s</div>
                      <div>p95 {(v.p95_ms / 1000).toFixed(1)}s</div>
                      <div>max {(v.max_ms / 1000).toFixed(1)}s</div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground mt-1">無資料</div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </CompanyLayout>
  );
}
