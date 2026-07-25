// PR-1: 三大法人 60 日冷啟動 admin 觸發卡片
// - Dry-run 先預覽計畫；正式執行走 time_budget 分批
// - 輪詢 cold_start_status 顯示進度與最近 attempts
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PlayCircle, RefreshCw, FlaskConical } from 'lucide-react';

type Attempt = { date: string; ok: boolean; rows: number; reason?: string };
type Status = {
  state: 'idle' | 'running' | 'done' | 'error';
  days_done: number;
  days_total: number;
  cursor_date: string | null;
  started_at: string | null;
  finished_at: string | null;
  source: string | null;
  last_error?: string | null;
  attempts?: Attempt[];
};

export function InstitutionalColdStartCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'idle' | 'dry' | 'run'>('idle');

  async function fetchStatus() {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('tw-institutional-daily-sync', {
        body: { mode: 'cold_start_status' },
      });
      if (error) throw error;
      setStatus(data?.status ?? null);
    } catch (e) {
      console.error('[cold-start] fetchStatus', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, 8000);
    return () => clearInterval(t);
  }, []);

  async function runDry() {
    setBusy('dry');
    try {
      const { data, error } = await supabase.functions.invoke('tw-institutional-daily-sync', {
        body: { mode: 'cold_start', dry_run: true, days: 60 },
      });
      if (error) throw error;
      const total = data?.total ?? 0;
      const est = data?.estimated_seconds ?? 0;
      toast.success(`Dry-run：規劃 ${total} 個交易日，預估 ~${est}s`);
    } catch (e) {
      toast.error(`Dry-run 失敗：${(e as Error).message}`);
    } finally {
      setBusy('idle');
    }
  }

  async function runReal(resume = false) {
    if (!confirm(resume ? '確定要從斷點續跑？' : '確定啟動 60 日冷啟動？每輪 ~4 分鐘，需點多次直到 done。')) return;
    setBusy('run');
    try {
      const { data, error } = await supabase.functions.invoke('tw-institutional-daily-sync', {
        body: { mode: 'cold_start', days: 60, resume, time_budget_ms: 240000 },
      });
      if (error) throw error;
      if (data?.ok === false) {
        toast.warning(data?.message ?? '無法啟動');
      } else {
        toast.success(`已推進 ${data?.done ?? 0}/${data?.planned ?? 0} 天${data?.stopped_reason ? `（${data.stopped_reason}）` : ''}`);
      }
      await fetchStatus();
    } catch (e) {
      toast.error(`Cold-start 失敗：${(e as Error).message}`);
    } finally {
      setBusy('idle');
    }
  }

  const pct = status && status.days_total > 0
    ? Math.min(100, Math.round((status.days_done / status.days_total) * 100))
    : 0;

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">三大法人 60 日冷啟動</h3>
          <p className="text-xs text-muted-foreground mt-1">
            一次性把過去 60 個交易日的全市場三大法人資料補齊；來源 TWSE T86 官方批次 API，節流 1.2s/call。
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={fetchStatus} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant={status?.state === 'done' ? 'default' : status?.state === 'running' ? 'secondary' : 'outline'}>
          {status?.state ?? 'unknown'}
        </Badge>
        <span className="text-sm text-muted-foreground">
          進度：{status?.days_done ?? 0} / {status?.days_total ?? 0}（{pct}%）
        </span>
        {status?.cursor_date && (
          <span className="text-xs text-muted-foreground">游標：{status.cursor_date}</span>
        )}
      </div>

      <div className="w-full h-2 bg-muted rounded overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={runDry} disabled={busy !== 'idle'}>
          <FlaskConical className="h-4 w-4 mr-1" /> Dry-run
        </Button>
        <Button size="sm" onClick={() => runReal(false)} disabled={busy !== 'idle' || status?.state === 'running'}>
          <PlayCircle className="h-4 w-4 mr-1" /> 啟動冷啟動
        </Button>
        <Button size="sm" variant="secondary" onClick={() => runReal(true)} disabled={busy !== 'idle'}>
          從斷點續跑
        </Button>
      </div>

      {status?.attempts && status.attempts.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">最近 {status.attempts.length} 次嘗試</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs">
            {status.attempts.slice().reverse().map((a, i) => (
              <div key={i} className="flex items-center justify-between px-2 py-1 rounded bg-muted/40">
                <span className="tabular-nums">{a.date}</span>
                <span className={a.ok ? 'text-emerald-600' : 'text-red-500'}>
                  {a.ok ? `✓ ${a.rows}` : `✗ ${a.reason?.slice(0, 40) ?? 'fail'}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {status?.last_error && (
        <div className="text-xs text-red-500">最後錯誤：{status.last_error}</div>
      )}
    </Card>
  );
}
