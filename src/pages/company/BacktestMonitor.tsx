import { useEffect, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Activity, RefreshCw, PlayCircle, Bell, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface RunRow {
  id: string;
  knowledge_item_id: string | null;
  status: string;
  win_rate: number | null;
  total_hits: number;
  error_message: string | null;
  run_mode: string;
  created_at: string;
  completed_at: string | null;
  parameters: any;
}

const fmtDateTime = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtPct = (v: number | null) => v == null ? '—' : `${(Number(v) * 100).toFixed(1)}%`;

export default function BacktestMonitor() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [items, setItems] = useState<Record<string, { title: string }>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState<'cron' | 'notify' | null>(null);
  const [lastCron, setLastCron] = useState<string | null>(null);
  const [backfill, setBackfill] = useState<{
    pending: number; done: number; empty: number; failed: number; total: number;
    latest_month: string | null; latest_date: string | null;
    current_symbol: string | null; current_yyyymm: string | null;
    recent_done_5min: number; eta_minutes: number | null;
  } | null>(null);

  const load = async () => {
    setLoading(true);
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const [
      { data: runsData },
      { data: itemsData },
      { data: bfAll },
      { data: bfLatest },
      { data: bfNext },
      { count: recentCount },
      { data: bfLatestDate },
    ] = await Promise.all([
      (supabase as any)
        .from('knowledge_backtest_runs')
        .select('id, knowledge_item_id, status, win_rate, total_hits, error_message, run_mode, created_at, completed_at, parameters')
        .neq('run_mode', 'grid_search')
        .order('created_at', { ascending: false })
        .limit(80),
      (supabase as any).from('checkup_knowledge_items').select('id, title'),
      (supabase as any).from('knowledge_backfill_progress').select('status'),
      (supabase as any).from('knowledge_backfill_progress')
        .select('yyyymm').eq('status', 'done')
        .order('yyyymm', { ascending: false }).limit(1).maybeSingle(),
      (supabase as any).from('knowledge_backfill_progress')
        .select('symbol, yyyymm').eq('status', 'pending')
        .order('symbol').order('yyyymm').limit(1).maybeSingle(),
      (supabase as any).from('knowledge_backfill_progress')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'done').gte('completed_at', fiveMinAgo),
      (supabase as any).from('daily_price_snapshots')
        .select('trade_date').order('trade_date', { ascending: false }).limit(1).maybeSingle(),
    ]);
    setRuns((runsData as RunRow[]) || []);
    const map: Record<string, { title: string }> = {};
    for (const it of itemsData || []) map[it.id] = { title: it.title };
    setItems(map);

    if (bfAll) {
      const counts = { pending: 0, done: 0, empty: 0, failed: 0 };
      for (const r of bfAll as any[]) {
        if (r.status === 'done') counts.done++;
        else if (r.status === 'empty') counts.empty++;
        else if (r.status === 'failed') counts.failed++;
        else counts.pending++;
      }
      const total = counts.done + counts.pending + counts.empty + counts.failed;
      const recent5 = recentCount ?? 0;
      const ratePerMin = recent5 / 5;
      const eta = ratePerMin > 0 ? Math.ceil(counts.pending / ratePerMin) : null;
      setBackfill({
        ...counts, total,
        latest_month: (bfLatest as any)?.yyyymm ?? null,
        latest_date: (bfLatestDate as any)?.trade_date ?? null,
        current_symbol: (bfNext as any)?.symbol ?? null,
        current_yyyymm: (bfNext as any)?.yyyymm ?? null,
        recent_done_5min: recent5,
        eta_minutes: eta,
      });
    }

    const cron = (runsData || []).find((r: any) =>
      r.run_mode === 'cron_weekly' ||
      r?.parameters?.trigger === 'auto_after_backfill' ||
      r?.parameters?.trigger === 'cron_nightly'
    );
    setLastCron(cron?.created_at ?? null);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const triggerNightly = async () => {
    setBusyAll('cron');
    try {
      const { error } = await supabase.functions.invoke('knowledge-backtest', {
        body: { mode: 'full', trigger: 'manual' },
      });
      if (error) throw error;
      toast({ title: '已觸發完整回測', description: '跑完會自動 Email 通知所有 admin。' });
      setTimeout(load, 2000);
    } catch (e: any) {
      toast({ title: '觸發失敗', description: String(e?.message ?? e), variant: 'destructive' });
    } finally { setBusyAll(null); }
  };

  const sendNotify = async () => {
    setBusyAll('notify');
    try {
      const { data, error } = await supabase.functions.invoke('notify-backtest-result', {
        body: { hours: 24, trigger: 'manual' },
      });
      if (error) throw error;
      toast({ title: 'Email 通知已送出', description: JSON.stringify(data) });
    } catch (e: any) {
      toast({ title: '通知失敗', description: String(e?.message ?? e), variant: 'destructive' });
    } finally { setBusyAll(null); }
  };

  const retryItem = async (itemId: string | null) => {
    if (!itemId) return;
    setBusyId(itemId);
    try {
      const { error } = await supabase.functions.invoke('knowledge-backtest', {
        body: { mode: 'single', item_id: itemId },
      });
      if (error) throw error;
      toast({ title: '已重新執行', description: items[itemId]?.title ?? itemId });
      setTimeout(load, 1500);
    } catch (e: any) {
      toast({ title: '重試失敗', description: String(e?.message ?? e), variant: 'destructive' });
    } finally { setBusyId(null); }
  };

  const last24 = runs.filter(r => Date.now() - new Date(r.created_at).getTime() < 86400_000);
  const success24 = last24.filter(r => r.status === 'completed').length;
  const failed24 = last24.filter(r => r.status === 'failed').length;

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6" /> 回測排程監控
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              每晚 22:00（台北）自動執行 <code>knowledge-backtest</code> full 模式。完成後自動 Email 通知所有 company_admin。
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 重新整理
            </Button>
            <Button variant="outline" size="sm" onClick={sendNotify} disabled={busyAll === 'notify'}>
              <Bell className="h-4 w-4" /> {busyAll === 'notify' ? '送出中…' : '補發 Email 通知（24h）'}
            </Button>
            <Button size="sm" onClick={triggerNightly} disabled={busyAll === 'cron'}>
              <PlayCircle className="h-4 w-4" /> {busyAll === 'cron' ? '執行中…' : '立即執行完整回測'}
            </Button>
          </div>
        </div>

        {backfill && backfill.done < 100 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            ⚠️ 目前 daily_price_snapshots 只有少量股票，回測樣本不足（多數知識條目會 sample_size &lt; 30，無法通過驗證門檻）。
            待回填批次完成（pending=0）後會自動觸發 full 回測；勝率/樣本數摘要會以 Email 寄達。
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">最近 cron 執行</div>
            <div className="text-sm font-semibold mt-1">{fmtDateTime(lastCron)}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">24h 成功</div>
            <div className="text-2xl font-semibold mt-1 text-green-600">{success24}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">24h 失敗</div>
            <div className={`text-2xl font-semibold mt-1 ${failed24 ? 'text-red-600' : ''}`}>{failed24}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">回填完成 / 總批次</div>
            <div className="text-sm font-semibold mt-1">
              {backfill ? `${backfill.done.toLocaleString()} / ${backfill.total.toLocaleString()}` : '—'}
            </div>
            {backfill && backfill.total > 0 && (
              <div className="w-full h-1.5 bg-muted rounded mt-2 overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${((backfill.done + backfill.empty) / backfill.total) * 100}%` }} />
              </div>
            )}
          </CardContent></Card>
        </div>

        {backfill && (
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">TWSE 日 K 回填細節</div>
                <Badge variant="outline" className="text-xs">
                  自動續跑 every 5 min
                </Badge>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="text-muted-foreground">目前處理中</div>
                  <div className="font-mono mt-0.5">
                    {backfill.current_symbol
                      ? `${backfill.current_symbol} / ${backfill.current_yyyymm}`
                      : '— 已清空'}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">最新完成月份</div>
                  <div className="font-mono mt-0.5">{backfill.latest_month ?? '—'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">最新交易日</div>
                  <div className="font-mono mt-0.5">{backfill.latest_date ?? '—'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">速率（近 5 分鐘）</div>
                  <div className="font-mono mt-0.5">{backfill.recent_done_5min} 批 / 5min</div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs pt-2 border-t">
                <div>
                  <div className="text-muted-foreground">待跑</div>
                  <div className="font-semibold mt-0.5 text-amber-600">{backfill.pending.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">完成</div>
                  <div className="font-semibold mt-0.5 text-emerald-600">{backfill.done.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">無資料 / 失敗</div>
                  <div className="font-semibold mt-0.5">
                    {backfill.empty.toLocaleString()} / <span className={backfill.failed ? 'text-red-600' : ''}>{backfill.failed.toLocaleString()}</span>
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">預估完成</div>
                  <div className="font-semibold mt-0.5">
                    {backfill.pending === 0 ? (
                      <span className="text-emerald-600">已完成 ✅</span>
                    ) : backfill.eta_minutes != null ? (
                      backfill.eta_minutes < 60
                        ? `~${backfill.eta_minutes} 分鐘`
                        : `~${(backfill.eta_minutes / 60).toFixed(1)} 小時`
                    ) : '計算中…'}
                  </div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground pt-1">
                💡 回填全部清空後會<b>自動觸發 knowledge-backtest 完整重算</b>，並寫入下方紀錄。
              </div>
            </CardContent>
          </Card>
        )}

        {failed24 > 0 && (
          <Card className="border-red-300 bg-red-50/50">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
              <div className="text-sm text-red-800">
                最近 24 小時有 <b>{failed24}</b> 筆回測失敗。請至下方表格點「重試」或檢查錯誤訊息（多半是
                <code className="mx-1 px-1 bg-white rounded">INSUFFICIENT_DATA</code>，需先回填股價）。
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                    <th className="text-left p-3">時間</th>
                    <th className="text-left p-3">知識條目</th>
                    <th className="text-left p-3">模式</th>
                    <th className="text-left p-3">狀態</th>
                    <th className="text-right p-3">勝率</th>
                    <th className="text-right p-3">樣本</th>
                    <th className="text-left p-3">錯誤訊息</th>
                    <th className="text-right p-3">動作</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">載入中…</td></tr>
                  ) : runs.length === 0 ? (
                    <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">尚無回測紀錄</td></tr>
                  ) : runs.map(r => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                      <td className="p-3">{items[r.knowledge_item_id ?? '']?.title ?? <span className="text-muted-foreground text-xs">—</span>}</td>
                      <td className="p-3 text-xs"><Badge variant="outline">{r.run_mode}</Badge></td>
                      <td className="p-3">
                        {r.status === 'completed' ? (
                          <Badge variant="outline" className="text-green-700 border-green-300"><CheckCircle2 className="h-3 w-3 mr-1" />成功</Badge>
                        ) : r.status === 'failed' ? (
                          <Badge variant="destructive">失敗</Badge>
                        ) : (
                          <Badge variant="secondary">{r.status}</Badge>
                        )}
                      </td>
                      <td className="p-3 text-right tabular-nums">{fmtPct(r.win_rate)}</td>
                      <td className="p-3 text-right tabular-nums text-muted-foreground">{r.total_hits || 0}</td>
                      <td className="p-3 text-xs text-red-600 max-w-xs truncate" title={r.error_message ?? ''}>
                        {r.error_message ?? '—'}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline" size="sm"
                          disabled={!r.knowledge_item_id || busyId === r.knowledge_item_id}
                          onClick={() => retryItem(r.knowledge_item_id)}
                        >
                          {busyId === r.knowledge_item_id ? '…' : '重試'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
}
