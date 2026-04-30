import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface Stats {
  done: number;
  pending: number;
  failed: number;
  empty: number;
  total: number;
  total_symbols: number;
  done_symbols: number;
  latest_month: string | null;
}

export function BackfillProgressPanel() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [doneRes, pendingRes, failedRes, emptyRes, totalRes, symAgg, latest] = await Promise.all([
        supabase.from('knowledge_backfill_progress').select('*', { count: 'exact', head: true }).eq('status', 'done'),
        supabase.from('knowledge_backfill_progress').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('knowledge_backfill_progress').select('*', { count: 'exact', head: true }).eq('status', 'failed'),
        supabase.from('knowledge_backfill_progress').select('*', { count: 'exact', head: true }).eq('status', 'empty'),
        supabase.from('knowledge_backfill_progress').select('*', { count: 'exact', head: true }),
        supabase.from('knowledge_backfill_progress').select('symbol').eq('status', 'done').limit(50000),
        supabase.from('knowledge_backfill_progress').select('yyyymm').eq('status', 'done').order('yyyymm', { ascending: false }).limit(1).maybeSingle(),
      ]);
      const allSyms = new Set((symAgg.data ?? []).map((r: any) => r.symbol));
      const allTotalSyms = await supabase
        .from('knowledge_backfill_progress')
        .select('symbol')
        .limit(100000);
      const totalSet = new Set((allTotalSyms.data ?? []).map((r: any) => r.symbol));
      setStats({
        done: doneRes.count ?? 0,
        pending: pendingRes.count ?? 0,
        failed: failedRes.count ?? 0,
        empty: emptyRes.count ?? 0,
        total: totalRes.count ?? 0,
        done_symbols: allSyms.size,
        total_symbols: totalSet.size,
        latest_month: (latest.data as any)?.yyyymm ?? null,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function startInitialize() {
    if (!window.confirm('初始化將為每個 symbol × 每個月份建立進度紀錄（pending）。確定？')) return;
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('backfill-daily-snapshots', {
        body: { months: 36 },
      });
      if (error) throw error;
      toast.success(`本批：寫入 ${data?.this_batch?.rows_inserted ?? 0} 筆${data?.partial ? '；尚有 ' + data?.progress?.pending + ' 個批次待跑' : ''}`);
      load();
    } catch (e: any) { toast.error(e?.message ?? String(e)); }
    finally { setRunning(false); }
  }

  async function continueRun() {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('backfill-daily-snapshots', {
        body: { resume: true },
      });
      if (error) throw error;
      toast.success(`本批：${data?.this_batch?.processed ?? 0} 個批次，寫入 ${data?.this_batch?.rows_inserted ?? 0} 筆${data?.partial ? '；剩餘 ' + data?.progress?.pending : '；全部完成 ✅'}`);
      load();
    } catch (e: any) { toast.error(e?.message ?? String(e)); }
    finally { setRunning(false); }
  }

  return (
    <div className="border rounded-lg p-4 bg-card space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-base font-medium">TWSE 日 K 回填進度</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            每次最多跑 ~50 個批次（~150 秒），請反覆按「續跑」直到完成
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          {stats && stats.total === 0 && (
            <Button size="sm" onClick={startInitialize} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              初始化（36 個月）
            </Button>
          )}
          {stats && stats.pending > 0 && (
            <Button size="sm" onClick={continueRun} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              續跑（剩 {stats.pending}）
            </Button>
          )}
          {stats && stats.failed > 0 && (
            <Button size="sm" variant="outline" onClick={async () => {
              await supabase.from('knowledge_backfill_progress').update({ status: 'pending' }).eq('status', 'failed');
              toast.success('已將 failed 重置為 pending');
              load();
            }}>重試 failed ({stats.failed})</Button>
          )}
        </div>
      </div>

      {stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Stat label="完成" value={stats.done} color="text-emerald-600" />
            <Stat label="待跑" value={stats.pending} color="text-amber-600" />
            <Stat label="失敗" value={stats.failed} color="text-red-600" />
            <Stat label="無資料" value={stats.empty} color="text-muted-foreground" />
            <Stat label="總批次" value={stats.total} />
          </div>
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
            <span>已完成 symbols：{stats.done_symbols} / {stats.total_symbols}</span>
            {stats.latest_month && <span>最新完成月份：{stats.latest_month}</span>}
            <span>整體進度：{stats.total > 0 ? ((stats.done / stats.total) * 100).toFixed(1) : 0}%</span>
          </div>
          {stats.total > 0 && (
            <div className="w-full h-2 bg-muted rounded overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all"
                style={{ width: `${(stats.done / stats.total) * 100}%` }} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="border rounded p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold ${color ?? ''}`}>{value.toLocaleString()}</p>
    </div>
  );
}
