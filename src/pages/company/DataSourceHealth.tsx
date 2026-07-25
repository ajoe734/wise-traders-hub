// PR-7 上游熔斷器監控頁
// 顯示 data_source_health 中每個上游來源的熔斷狀態、視窗成功/失敗數、冷卻結束時間，
// 提供管理員手動 reset 熔斷。
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import SEO from '@/components/SEO';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { RefreshCw, ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';

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

const STATE_META: Record<string, { label: string; color: string; Icon: typeof ShieldCheck }> = {
  closed:    { label: '正常 (closed)',       color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', Icon: ShieldCheck },
  half_open: { label: '半開探測 (half_open)', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',       Icon: ShieldQuestion },
  open:      { label: '熔斷中 (open)',        color: 'bg-red-500/15 text-red-700 dark:text-red-300',              Icon: ShieldAlert },
};

function fmtTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleString('zh-TW', { hour12: false })}（${formatDistanceToNow(d, { locale: zhTW, addSuffix: true })}）`;
}

export default function DataSourceHealth() {
  const qc = useQueryClient();
  const [resetting, setResetting] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['company', 'data-source-health'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('data_source_health')
        .select('*')
        .order('source', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Row[];
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

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <SEO
        title="上游熔斷監控 | legendflow"
        description="TWSE T86 / FinMind BSR 等上游來源的熔斷狀態、失敗率與冷卻時間。"
        path="/company/data-source-health"
        noindex
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">上游熔斷監控</h1>
          <p className="text-sm text-muted-foreground mt-1">
            PR-7：連續 5 次失敗或 10 分鐘視窗內失敗過多會自動 open；冷卻 5 分鐘後半開探測，
            探測成功即恢復，失敗則冷卻加倍（上限 30 分鐘）。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          重新整理
        </Button>
      </div>

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
    </div>
  );
}
