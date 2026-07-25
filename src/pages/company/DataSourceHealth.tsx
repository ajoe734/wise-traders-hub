// PR-8/PR-9: 上游熔斷 + Quota Pools + Kill-Switches 監控頁
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import SEO from '@/components/SEO';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { RefreshCw, ShieldCheck, ShieldAlert, ShieldQuestion, Gauge, Power } from 'lucide-react';

type Row = {
  source: string;
  circuit_state: 'closed' | 'open' | 'half_open' | string;
  consecutive_failures: number;
  ok_count_10m: number;
  fail_count_10m: number;
  disabled_until: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error_code: string | null;
  p95_latency_ms: number | null;
  updated_at: string;
};

type PoolRow = {
  pool_name: string;
  daily_budget: number;
  used_today: number;
  window_start_at: string;
  updated_at: string;
};

type SwitchRow = {
  key: string;
  enabled: boolean;
  description: string | null;
  disabled_reason: string | null;
  disabled_at: string | null;
  auto_trigger_metric: string | null;
  updated_at: string;
};

const STATE_META: Record<string, { label: string; color: string; Icon: typeof ShieldCheck }> = {
  closed:    { label: '正常 (closed)',       color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', Icon: ShieldCheck },
  half_open: { label: '半開探測 (half_open)', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',       Icon: ShieldQuestion },
  open:      { label: '熔斷中 (open)',        color: 'bg-red-500/15 text-red-700 dark:text-red-300',              Icon: ShieldAlert },
};

const POOL_LABEL: Record<string, string> = {
  interactive: '互動 (使用者觸發)',
  keepwarm: '常駐暖機 (排程)',
  backfill: '回補 (新股 60d)',
};

function fmtTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleString('zh-TW', { hour12: false })}（${formatDistanceToNow(d, { locale: zhTW, addSuffix: true })}）`;
}

export default function DataSourceHealth() {
  const qc = useQueryClient();
  const [resetting, setResetting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [budgetEditing, setBudgetEditing] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['company', 'data-source-health'],
    queryFn: async () => {
      const { data, error } = await supabase.from('data_source_health').select('*').order('source', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 15_000,
  });

  const { data: pools, refetch: refetchPools } = useQuery({
    queryKey: ['company', 'finmind-pools'],
    queryFn: async () => {
      const { data, error } = await supabase.from('finmind_quota_pools').select('*').order('pool_name');
      if (error) throw error;
      return (data ?? []) as PoolRow[];
    },
    refetchInterval: 15_000,
  });

  const { data: switches, refetch: refetchSwitches } = useQuery({
    queryKey: ['company', 'kill-switches'],
    queryFn: async () => {
      const { data, error } = await supabase.from('system_kill_switches').select('*').order('key');
      if (error) throw error;
      return (data ?? []) as SwitchRow[];
    },
    refetchInterval: 15_000,
  });

  async function handleReset(source: string) {
    if (!confirm(`確定要重置 ${source} 的熔斷狀態嗎？此動作會立刻允許呼叫。`)) return;
    setResetting(source);
    try {
      const { error } = await supabase.rpc('reset_data_source_circuit', { _source: source });
      if (error) throw error;
      toast.success(`已重置 ${source}`);
      await qc.invalidateQueries({ queryKey: ['company', 'data-source-health'] });
    } catch (e) {
      toast.error(`重置失敗：${(e as Error).message}`);
    } finally {
      setResetting(null);
    }
  }

  async function toggleSwitch(key: string, next: boolean) {
    const reason = next ? '' : (prompt(`關閉 ${key} 的理由？（會寫入 disabled_reason）`, '手動關閉') ?? '');
    if (!next && !reason) return;
    setToggling(key);
    try {
      const { error } = await supabase.rpc('toggle_kill_switch', {
        _key: key, _enabled: next, _reason: next ? null : reason,
      });
      if (error) throw error;
      toast.success(`${key} 已 ${next ? '啟用' : '停用'}`);
      await refetchSwitches();
    } catch (e) {
      toast.error(`切換失敗：${(e as Error).message}`);
    } finally {
      setToggling(null);
    }
  }

  async function updateBudget(pool: string, current: number) {
    const raw = prompt(`${pool} 每日配額（目前 ${current}）`, String(current));
    if (!raw) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) { toast.error('請輸入非負整數'); return; }
    setBudgetEditing(pool);
    try {
      const { error } = await supabase.rpc('finmind_pool_set_budget', { _pool: pool, _budget: Math.floor(n) });
      if (error) throw error;
      toast.success(`${pool} 配額已更新為 ${Math.floor(n)}`);
      await refetchPools();
    } catch (e) {
      toast.error(`更新失敗：${(e as Error).message}`);
    } finally {
      setBudgetEditing(null);
    }
  }

  async function resetAllPools() {
    if (!confirm('確定要立刻重置全部 pool 的當日 used_today？通常用於升級 FinMind 方案。')) return;
    try {
      const { error } = await supabase.rpc('finmind_pool_reset');
      if (error) throw error;
      toast.success('已重置所有 pool');
      await refetchPools();
    } catch (e) {
      toast.error(`重置失敗：${(e as Error).message}`);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <SEO
        title="上游熔斷 · Quota · Kill-Switch | legendflow"
        description="TWSE T86 / FinMind BSR 熔斷、三 pool 配額狀態、系統緊急開關。"
        path="/company/data-source-health"
        noindex
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">上游熔斷 · Quota · Kill-Switch</h1>
          <p className="text-sm text-muted-foreground mt-1">
            PR-7 熔斷 + PR-8 三 pool 配額 + PR-9 緊急開關；guardian 每 5 分鐘自動巡檢。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { refetch(); refetchPools(); refetchSwitches(); }} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          重新整理
        </Button>
      </div>

      {/* Quota Pools */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Gauge className="h-4 w-4" />FinMind Quota Pools</h2>
          <Button variant="ghost" size="sm" onClick={resetAllPools}>重置全部 used_today</Button>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {(pools ?? []).map((p) => {
            const remaining = Math.max(0, p.daily_budget - p.used_today);
            const pct = p.daily_budget > 0 ? Math.min(100, Math.round((p.used_today / p.daily_budget) * 100)) : 0;
            const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
            return (
              <Card key={p.pool_name}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{POOL_LABEL[p.pool_name] ?? p.pool_name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-lg">{p.used_today}<span className="text-muted-foreground text-xs"> / {p.daily_budget}</span></span>
                    <span className="text-muted-foreground text-xs">剩 {remaining}</span>
                  </div>
                  <div className="h-2 rounded bg-muted overflow-hidden">
                    <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-xs text-muted-foreground">視窗自 {fmtTime(p.window_start_at)}</div>
                  <div className="flex justify-end">
                    <Button size="sm" variant="outline" disabled={budgetEditing === p.pool_name} onClick={() => updateBudget(p.pool_name, p.daily_budget)}>
                      調整配額
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Kill-Switches */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Power className="h-4 w-4" />緊急開關 (Kill-Switches)</h2>
        <div className="grid gap-2">
          {(switches ?? []).map((s) => (
            <Card key={s.key}>
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{s.key}</span>
                    <Badge className={s.enabled ? 'bg-emerald-500/15 text-emerald-700' : 'bg-red-500/15 text-red-700'}>
                      {s.enabled ? 'enabled' : 'disabled'}
                    </Badge>
                    {s.auto_trigger_metric && <Badge variant="outline" className="text-xs">auto</Badge>}
                  </div>
                  {s.description && <p className="text-xs text-muted-foreground mt-1">{s.description}</p>}
                  {!s.enabled && s.disabled_reason && (
                    <p className="text-xs text-red-600 mt-1">關閉原因：{s.disabled_reason}（{fmtTime(s.disabled_at)}）</p>
                  )}
                </div>
                <Switch
                  checked={s.enabled}
                  disabled={toggling === s.key}
                  onCheckedChange={(v) => toggleSwitch(s.key, v)}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Circuit Breakers */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold flex items-center gap-2"><ShieldCheck className="h-4 w-4" />上游熔斷器</h2>
        {isLoading ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground">載入中…</CardContent></Card>
        ) : !data || data.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground">
            尚無資料。等待第一次上游呼叫寫入 data_source_health 後就會顯示。
          </CardContent></Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.map((row) => {
              const meta = STATE_META[row.circuit_state] ?? STATE_META.closed;
              const cooling = row.circuit_state === 'open' && row.disabled_until
                && new Date(row.disabled_until).getTime() > Date.now();
              return (
                <Card key={row.source}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-mono">{row.source}</CardTitle>
                      <Badge className={meta.color}>
                        <meta.Icon className="mr-1 h-3.5 w-3.5" />
                        {meta.label}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <span className="text-muted-foreground">連續失敗</span>
                      <span className="font-mono">{row.consecutive_failures}</span>

                      <span className="text-muted-foreground">10m 成功 / 失敗</span>
                      <span className="font-mono">{row.ok_count_10m} / {row.fail_count_10m}</span>

                      <span className="text-muted-foreground">最近延遲</span>
                      <span className="font-mono">{row.p95_latency_ms ?? '—'} ms</span>

                      <span className="text-muted-foreground">最後錯誤碼</span>
                      <span className="font-mono">{row.last_error_code ?? '—'}</span>

                      <span className="text-muted-foreground">最後成功</span>
                      <span className="text-xs">{fmtTime(row.last_success_at)}</span>

                      <span className="text-muted-foreground">最後失敗</span>
                      <span className="text-xs">{fmtTime(row.last_failure_at)}</span>
                    </div>

                    {cooling && (
                      <div className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                        冷卻至 <span className="font-mono">{fmtTime(row.disabled_until)}</span>
                      </div>
                    )}

                    <div className="flex justify-end pt-2">
                      <Button
                        size="sm"
                        variant={row.circuit_state === 'closed' ? 'outline' : 'default'}
                        disabled={resetting === row.source}
                        onClick={() => handleReset(row.source)}
                      >
                        {resetting === row.source ? '重置中…' : '重置為 closed'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
