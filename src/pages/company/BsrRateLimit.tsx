import { SEO } from '@/components/SEO';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, PlayCircle, ListPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';


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
  snapshot?: {
    window_days: number;
    total_days: number;
    ready_days: number;
    partial_days: number;
    exhausted_days: number;
    hit_ratio_24h: number | null;
    quota_per_day_avg: number | null;
    oldest_pending_days: number;
  } | null;
  tier_admission?: Record<string, {
    allowed: boolean; reason: string;
    hourly_used: number; tier_used: number;
    tier_guarantee: number; available_for_tier: number;
  }>;
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

        {/* M3 v2: Snapshot-First 命中率 */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-medium">Snapshot-First 命中率（L2 Coalesced Fetch）</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                每個 trade_date 是原子單位；同日多檔 job 由單次 market-batch 抓取後批量 fulfill。
              </div>
            </div>
            <Button size="sm" variant="outline" disabled={!!busy} className="gap-2"
              onClick={() => runAction('探測 market-batch 支援', { mode: 'probe', force: true })}>
              <PlayCircle className="h-4 w-4" /> Probe
            </Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground">24h 命中率</div>
              <div className={`text-lg font-semibold font-mono ${
                (data?.snapshot?.hit_ratio_24h ?? 0) >= 80 ? 'text-emerald-600' :
                (data?.snapshot?.hit_ratio_24h ?? 0) >= 50 ? 'text-amber-600' :
                data?.snapshot?.hit_ratio_24h != null ? 'text-destructive' : ''
              }`}>
                {data?.snapshot?.hit_ratio_24h != null ? `${data.snapshot.hit_ratio_24h}%` : '—'}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">{data?.snapshot?.window_days ?? 14}d Ready</div>
              <div className="text-lg font-semibold font-mono text-emerald-700">
                {data?.snapshot?.ready_days ?? '—'}
                <span className="text-xs text-muted-foreground ml-1">/ {data?.snapshot?.total_days ?? '—'}</span>
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Partial</div>
              <div className="text-lg font-semibold font-mono text-amber-600">
                {data?.snapshot?.partial_days ?? '—'}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Exhausted</div>
              <div className="text-lg font-semibold font-mono text-muted-foreground">
                {data?.snapshot?.exhausted_days ?? '—'}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">平均 quota/日</div>
              <div className={`text-lg font-semibold font-mono ${
                (data?.snapshot?.quota_per_day_avg ?? 0) > 100 ? 'text-amber-600' : ''
              }`}>
                {data?.snapshot?.quota_per_day_avg ?? '—'}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">最舊 pending</div>
              <div className={`text-lg font-semibold font-mono ${
                (data?.snapshot?.oldest_pending_days ?? 0) >= 3 ? 'text-destructive' : ''
              }`}>
                {data?.snapshot?.oldest_pending_days ?? 0} 天
              </div>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            命中率 = 24h 內完成的 job 中，透過共用 daily snapshot（fetched_at ±5s）批量 fulfill 的比例；
            越接近 100% 代表 coalesced fetch 越有效，quota 消耗越低。目標 ≥80%。
          </p>
        </Card>

        {/* M3 v2: Tier Admission Elastic Share */}
        <Card className="p-4">
          <div className="text-sm font-medium mb-3">
            Tier Admission（L3 Elastic Share Limiter）
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left py-2 pr-3">Tier</th>
                  <th className="text-left py-2 pr-3">用途</th>
                  <th className="text-right py-2 pr-3">保底</th>
                  <th className="text-right py-2 pr-3">已用</th>
                  <th className="text-right py-2 pr-3">可用</th>
                  <th className="text-left py-2 pr-3">狀態</th>
                  <th className="text-left py-2 pr-3">原因</th>
                </tr>
              </thead>
              <tbody>
                {([
                  { key: 'tier1', label: 'T1 · 持倉即時', g: '40%' },
                  { key: 'tier2', label: 'T2 · 缺口補齊', g: '20%' },
                  { key: 'tier3', label: 'T3 · 歷史回填', g: '5%' },
                ] as const).map(({ key, label, g }) => {
                  const row = data?.tier_admission?.[key];
                  const tone =
                    !row ? '' :
                    row.allowed && row.reason === 'ok' ? 'text-emerald-700' :
                    row.allowed ? 'text-amber-600' :
                    'text-destructive';
                  return (
                    <tr key={key} className="border-t">
                      <td className="py-2 pr-3 font-mono">{key.toUpperCase()}</td>
                      <td className="py-2 pr-3">{label}</td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {row?.tier_guarantee ?? '—'} <span className="text-muted-foreground">({g})</span>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">{row?.tier_used ?? '—'}</td>
                      <td className="py-2 pr-3 text-right font-mono">{row?.available_for_tier ?? '—'}</td>
                      <td className={`py-2 pr-3 font-mono ${tone}`}>
                        {row ? (row.allowed ? '✓ 允許' : '✗ 拒絕') : '—'}
                      </td>
                      <td className="py-2 pr-3 font-mono text-muted-foreground">{row?.reason ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            Elastic share：高階 tier 未用完的保底可被低階 tier 借用；一旦高階需要，低階即被 squeezed。
            當 reason = <span className="font-mono">min_guarantee</span> 代表已進入保底區、
            <span className="font-mono"> squeezed_by_higher_tier</span> 代表被高階擠壓禁止入場。
            全域 hourly 用量：<span className="font-mono">{data?.tier_admission?.tier1?.hourly_used ?? '—'}</span> / {data?.rate_limit.limit ?? 1500}。
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

        <PerStockStatusCard />




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

type QueueRow = {
  stock_id: string;
  priority: number;
  status: string;
  attempts: number;
  last_success_at: string | null;
  last_error: string | null;
  next_run_at: string | null;
  updated_at: string;
  finished_at: string | null;
};

type PerStockRow = {
  stock_id: string;
  tier: number;
  status: string;
  attempts: number;
  last_processed_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  next_run_at: string | null;
  updated_at: string;
};

const TIER_LABEL: Record<number, { label: string; tone: string }> = {
  1: { label: 'Tier1 持倉', tone: 'bg-red-100 text-red-800 border-red-300' },
  2: { label: 'Tier2 缺口', tone: 'bg-amber-100 text-amber-800 border-amber-300' },
  3: { label: 'Tier3 回填', tone: 'bg-slate-100 text-slate-700 border-slate-300' },
};

const STATUS_TONE: Record<string, string> = {
  done: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  running: 'bg-blue-100 text-blue-800 border-blue-300',
  pending: 'bg-neutral-100 text-neutral-700 border-neutral-300',
  failed: 'bg-red-100 text-red-800 border-red-300',
  dead: 'bg-neutral-800 text-neutral-50 border-neutral-900',
};

function fmtTime(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-TW');
}

function fmtAge(v: string | null): string {
  if (!v) return '—';
  const diff = Date.now() - new Date(v).getTime();
  if (Number.isNaN(diff) || diff < 0) return '—';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function PerStockStatusCard() {
  const [filter, setFilter] = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | '1' | '2' | '3'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'running' | 'done' | 'failed' | 'dead'>('all');
  const [sortBy, setSortBy] = useState<'updated' | 'processed' | 'tier' | 'status'>('updated');

  const { data, isFetching, refetch } = useQuery<QueueRow[]>({
    queryKey: ['company', 'bsr-per-stock-queue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tw_bsr_sync_queue')
        .select('stock_id, priority, status, attempts, last_success_at, last_error, next_run_at, updated_at, finished_at')
        .order('updated_at', { ascending: false })
        .limit(2000);
      if (error) throw new Error(error.message);
      return (data ?? []) as QueueRow[];
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const rows = useMemo<PerStockRow[]>(() => {
    const byStock = new Map<string, PerStockRow>();
    for (const r of data ?? []) {
      const existing = byStock.get(r.stock_id);
      const lastProcessed = r.finished_at || r.last_success_at || r.updated_at;
      const candidate: PerStockRow = {
        stock_id: r.stock_id,
        tier: r.priority,
        status: r.status,
        attempts: r.attempts,
        last_processed_at: lastProcessed,
        last_success_at: r.last_success_at,
        last_error: r.last_error,
        next_run_at: r.next_run_at,
        updated_at: r.updated_at,
      };
      if (!existing) {
        byStock.set(r.stock_id, candidate);
      } else {
        // keep highest tier (lowest priority number) and freshest updated_at
        if (r.priority < existing.tier) byStock.set(r.stock_id, { ...candidate, tier: r.priority });
        else if (new Date(r.updated_at) > new Date(existing.updated_at)) byStock.set(r.stock_id, { ...candidate, tier: existing.tier });
      }
    }
    let arr = Array.from(byStock.values());
    if (tierFilter !== 'all') arr = arr.filter((r) => String(r.tier) === tierFilter);
    if (statusFilter !== 'all') arr = arr.filter((r) => r.status === statusFilter);
    const q = filter.trim().toLowerCase();
    if (q) arr = arr.filter((r) => r.stock_id.toLowerCase().includes(q) || (r.last_error ?? '').toLowerCase().includes(q));
    arr.sort((a, b) => {
      if (sortBy === 'tier') return a.tier - b.tier || a.stock_id.localeCompare(b.stock_id);
      if (sortBy === 'status') return a.status.localeCompare(b.status) || a.stock_id.localeCompare(b.stock_id);
      if (sortBy === 'processed') return (new Date(b.last_processed_at ?? 0).getTime()) - (new Date(a.last_processed_at ?? 0).getTime());
      return (new Date(b.updated_at).getTime()) - (new Date(a.updated_at).getTime());
    });
    return arr;
  }, [data, filter, tierFilter, statusFilter, sortBy]);

  const summary = useMemo(() => {
    const s = { total: rows.length, done: 0, pending: 0, running: 0, failed: 0, dead: 0 } as Record<string, number>;
    for (const r of rows) {
      if (r.status === 'done') s.done++;
      else if (r.status === 'pending') s.pending++;
      else if (r.status === 'running') s.running++;
      else if (r.status === 'failed') s.failed++;
      else if (r.status === 'dead') s.dead++;
    }
    return s;
  }, [rows]);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div>
          <div className="text-sm font-medium">每檔標的同步狀態</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            共 {summary.total} 檔 · done {summary.done} · pending {summary.pending} · running {summary.running}
            {summary.failed ? ` · failed ${summary.failed}` : ''}{summary.dead ? ` · dead ${summary.dead}` : ''}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} /> 重新整理
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap mb-3">
        <Input
          placeholder="搜尋股票代碼或錯誤訊息…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 w-64"
        />
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value as any)}
          className="h-8 border rounded px-2 text-xs bg-background"
        >
          <option value="all">全部 Tier</option>
          <option value="1">Tier1 持倉</option>
          <option value="2">Tier2 缺口</option>
          <option value="3">Tier3 回填</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="h-8 border rounded px-2 text-xs bg-background"
        >
          <option value="all">全部狀態</option>
          <option value="done">done</option>
          <option value="running">running</option>
          <option value="pending">pending</option>
          <option value="failed">failed</option>
          <option value="dead">dead</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="h-8 border rounded px-2 text-xs bg-background"
        >
          <option value="updated">依 updated_at</option>
          <option value="processed">依 last processed</option>
          <option value="tier">依 tier</option>
          <option value="status">依 status</option>
        </select>
      </div>

      <div className="overflow-x-auto border rounded max-h-[520px]">
        <table className="w-full text-xs">
          <thead className="bg-muted sticky top-0 z-10">
            <tr>
              <th className="p-2 text-left">股票</th>
              <th className="p-2 text-left">Tier</th>
              <th className="p-2 text-left">狀態</th>
              <th className="p-2 text-right">Attempts</th>
              <th className="p-2 text-left">Last processed</th>
              <th className="p-2 text-left">Last success</th>
              <th className="p-2 text-left">Next run</th>
              <th className="p-2 text-left">最近錯誤</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const tierMeta = TIER_LABEL[r.tier] ?? TIER_LABEL[3];
              const statusTone = STATUS_TONE[r.status] ?? 'bg-neutral-100 text-neutral-700 border-neutral-300';
              return (
                <tr key={r.stock_id} className="border-t align-top">
                  <td className="p-2 font-mono font-semibold">{r.stock_id}</td>
                  <td className="p-2">
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] ${tierMeta.tone}`}>{tierMeta.label}</span>
                  </td>
                  <td className="p-2">
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${statusTone}`}>{r.status}</span>
                  </td>
                  <td className="p-2 text-right font-mono">{r.attempts}</td>
                  <td className="p-2 font-mono whitespace-nowrap">
                    {fmtTime(r.last_processed_at)}
                    <span className="text-muted-foreground ml-1">({fmtAge(r.last_processed_at)})</span>
                  </td>
                  <td className="p-2 font-mono whitespace-nowrap">
                    {r.last_success_at ? (
                      <>
                        {fmtTime(r.last_success_at)}
                        <span className="text-muted-foreground ml-1">({fmtAge(r.last_success_at)})</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-2 font-mono whitespace-nowrap">{fmtTime(r.next_run_at)}</td>
                  <td className="p-2 max-w-[280px]">
                    {r.last_error ? (
                      <span className="text-destructive break-words" title={r.last_error}>{r.last_error}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">尚無符合條件的資料</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">
        以 <span className="font-mono">tw_bsr_sync_queue</span> 為權威來源，最新 2000 筆按 stock_id 去重，Tier 取該標的最高優先級。
        「Last processed」= finished_at → last_success_at → updated_at；點欄位下拉可切換排序、輸入框可同時搜尋代碼與錯誤訊息。
      </p>
    </Card>
  );
}

