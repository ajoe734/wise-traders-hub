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
  stuck_reservations?: Array<{
    id: number; correlation_id: string | null;
    reserved_at: string; expires_at: string; age_seconds: number; expired: boolean;
  }>;
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

        {/* Degrade 狀態機面板 */}
        {data?.degrade && (() => {
          const meta = MODE_LABEL[data.degrade!.mode] ?? MODE_LABEL.normal;
          const p = data.degrade!.policy;
          return (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium">自動降級狀態機</div>
                <div className={`px-2 py-0.5 rounded border text-xs font-medium ${meta.tone}`}>
                  目前：{meta.label}（{data.degrade!.mode}）
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="text-muted-foreground">觸發原因</div>
                  <div className="font-medium">{data.degrade!.reason ?? '—'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">觸發指標</div>
                  <div className="font-mono">
                    {data.degrade!.trigger_metric ?? '—'}
                    {data.degrade!.trigger_value != null ? ` = ${Number(data.degrade!.trigger_value).toFixed(1)}` : ''}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">開始時間</div>
                  <div className="font-mono">{data.degrade!.since ? new Date(data.degrade!.since).toLocaleString('zh-TW') : '—'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Cooldown 到期</div>
                  <div className="font-mono">{data.degrade!.cooldown_until ? new Date(data.degrade!.cooldown_until).toLocaleString('zh-TW') : '—'}</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div><span className="text-muted-foreground">最高優先級</span><span className="ml-2 font-mono">P{p.max_priority}</span></div>
                <div><span className="text-muted-foreground">併發</span><span className="ml-2 font-mono">{p.concurrency}</span></div>
                <div><span className="text-muted-foreground">允許 Claim</span><span className={`ml-2 font-mono ${p.allow_claim ? '' : 'text-destructive'}`}>{p.allow_claim ? 'yes' : 'HALT'}</span></div>
                <div><span className="text-muted-foreground">允許 Tier3 入列</span><span className={`ml-2 font-mono ${p.allow_enqueue_tier3 ? '' : 'text-amber-600'}`}>{p.allow_enqueue_tier3 ? 'yes' : 'no'}</span></div>
              </div>
              <div className="mt-4">
                <div className="text-xs font-medium mb-1">最近轉移事件</div>
                <div className="overflow-x-auto max-h-64 border rounded">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="p-2 text-left">時間</th>
                        <th className="p-2 text-left">From → To</th>
                        <th className="p-2 text-left">原因</th>
                        <th className="p-2 text-left">指標</th>
                        <th className="p-2 text-right">值 / 閾值</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.degrade!.recent_transitions.map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="p-2 font-mono">{new Date(r.created_at).toLocaleString('zh-TW')}</td>
                          <td className="p-2 font-mono">{r.from_mode} → {r.to_mode}</td>
                          <td className="p-2">{r.reason}</td>
                          <td className="p-2 font-mono">{r.trigger_metric ?? '—'}</td>
                          <td className="p-2 text-right font-mono">
                            {r.trigger_value != null ? Number(r.trigger_value).toFixed(1) : '—'}
                            {r.threshold != null ? ` / ${Number(r.threshold).toFixed(1)}` : ''}
                          </td>
                        </tr>
                      ))}
                      {!data.degrade!.recent_transitions.length && (
                        <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">尚無降級事件</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-3">
                狀態機規則：用量 ≥80% → Tier3 暫停；≥90% 或 429 連續 ≥3 分 → Tier2 暫停；reservation stuck → Claim 停手。
                恢復需 cooldown 到期並逐級退回（不會一次跳回 normal），避免震盪。
              </p>
            </Card>
          );
        })()}

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
            過期未結算 &gt; 0 由 cron <span className="font-mono">tw-bsr-purge-expired-reservations</span>（* * * * *，每分鐘）自動回收；
            worker 每次執行前也會主動 purge 一次。lease 預設 25 秒（fetch abort 20s + 5s buffer）。
            告警閾值：用量 ≥80%、最舊 in-flight ≥60s、429 連續 ≥3 分鐘、P1 pending ≥30 分。
          </p>
        </Card>

        {/* Stuck reservations（≥30s in-flight）：任何 worker crash/timeout 都會在這裡浮現 */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">卡住的 Reservation（≥30 秒未結算）</div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={!!busy} className="gap-2"
                onClick={() => runAction('立即 purge 過期 lease', { mode: 'purge_reservations' })}>
                <RefreshCw className="h-4 w-4" /> 立即 purge
              </Button>
            </div>
          </div>
          {(data?.stuck_reservations?.length ?? 0) === 0 ? (
            <div className="text-xs text-muted-foreground">目前沒有卡住的 reservation。</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="text-left py-2 pr-3">ID</th>
                    <th className="text-left py-2 pr-3">Correlation ID</th>
                    <th className="text-left py-2 pr-3">Reserved At</th>
                    <th className="text-right py-2 pr-3">Age</th>
                    <th className="text-left py-2 pr-3">狀態</th>
                    <th className="text-right py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.stuck_reservations!.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-mono">{r.id}</td>
                      <td className="py-2 pr-3 font-mono text-[10px]">{r.correlation_id ?? '—'}</td>
                      <td className="py-2 pr-3 font-mono">{new Date(r.reserved_at).toLocaleTimeString('zh-TW')}</td>
                      <td className={`py-2 pr-3 text-right font-mono ${r.age_seconds >= 60 ? 'text-destructive' : ''}`}>{r.age_seconds}s</td>
                      <td className="py-2 pr-3">
                        {r.expired ? <Badge variant="destructive">已過期</Badge> : <Badge variant="secondary">執行中</Badge>}
                      </td>
                      <td className="py-2 text-right">
                        <Button size="sm" variant="ghost" disabled={!!busy}
                          onClick={() => runAction(`強制回收 #${r.id}`, {
                            mode: 'force_recycle_reservation', reservation_id: r.id, reason: 'admin_ui_force_recycle',
                          })}>
                          強制回收
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-muted-foreground mt-2">
                「已過期」表示 lease 已超時但尚未被 cron 掃到 — 按「立即 purge」可以馬上回收；
                「執行中」是還在 lease 內的正常 in-flight，通常不需操作。手動強制回收會寫入 <span className="font-mono">recycle_reason</span> 供 audit。
              </p>
            </div>
          )}
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
