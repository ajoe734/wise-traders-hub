import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { errorMessage } from '@/lib/errorMessage';
import type {
  BackfillProgressRow,
  BackfillSnapshot,
  BackfillSymbolRow,
  FailedBackfillRow,
  KnowledgeItemRow,
  MonitorSnapshot,
  NotifyLog,
  NotifyLogRow,
  RunRow,
} from '@/pages/_backtestMonitor/types';

export function useBacktestMonitor() {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState<'cron' | 'notify' | null>(null);

  const { data: snapshot, isFetching, refetch } = useQuery<MonitorSnapshot>({
    queryKey: ['company', 'backtest-monitor'],
    queryFn: async () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      const [
        { data: runsData },
        { data: itemsData },
        { data: bfAll },
        { data: bfLatest },
        { data: bfNext },
        { count: recentCount },
        { data: bfLatestDate },
        { data: bfFailed },
        { data: bfLastAttempt },
        { data: notifyLogs },
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
        (supabase as any).from('knowledge_backfill_progress')
          .select('symbol, yyyymm, error_message, attempted_at')
          .eq('status', 'failed')
          .order('attempted_at', { ascending: false }).limit(20),
        (supabase as any).from('knowledge_backfill_progress')
          .select('attempted_at').not('attempted_at', 'is', null)
          .order('attempted_at', { ascending: false }).limit(1).maybeSingle(),
        (supabase as any).from('function_run_logs')
          .select('created_at, payload, msg, level')
          .eq('fn', 'notify-backtest-result')
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
          .then((r: any) => r).catch(() => ({ data: null })),
      ]);
      const runs = (runsData as RunRow[] | null) ?? [];
      const items: Record<string, { title: string }> = {};
      for (const it of (itemsData as KnowledgeItemRow[] | null) ?? []) {
        items[it.id] = { title: it.title };
      }
      const failedBackfills = (bfFailed as FailedBackfillRow[] | null) ?? [];
      const reasonMap = new Map<string, number>();
      for (const r of failedBackfills) {
        const reason = (r.error_message || '未知錯誤').slice(0, 200);
        reasonMap.set(reason, (reasonMap.get(reason) || 0) + 1);
      }
      const failedBackfillReasons = Array.from(reasonMap.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count).slice(0, 5);

      let notifyLog: NotifyLog | null = null;
      if (notifyLogs) {
        const row = notifyLogs as NotifyLogRow;
        const p = row.payload ?? {};
        notifyLog = {
          created_at: row.created_at,
          email_sent: p.email_sent ?? 0,
          email_failed: p.email_failed ?? 0,
          errors: Array.isArray(p.errors) ? (p.errors as string[]) : [],
        };
      }

      let backfill: BackfillSnapshot | null = null;
      if (bfAll) {
        const counts = { pending: 0, done: 0, empty: 0, failed: 0 };
        for (const r of bfAll as BackfillProgressRow[]) {
          if (r.status === 'done') counts.done++;
          else if (r.status === 'empty') counts.empty++;
          else if (r.status === 'failed') counts.failed++;
          else counts.pending++;
        }
        const total = counts.done + counts.pending + counts.empty + counts.failed;
        const recent5 = recentCount ?? 0;
        const ratePerMin = recent5 / 5;
        const eta = ratePerMin > 0 ? Math.ceil(counts.pending / ratePerMin) : null;
        backfill = {
          ...counts, total,
          latest_month: (bfLatest as BackfillSymbolRow | null)?.yyyymm ?? null,
          latest_date: (bfLatestDate as { trade_date: string | null } | null)?.trade_date ?? null,
          current_symbol: (bfNext as BackfillSymbolRow | null)?.symbol ?? null,
          current_yyyymm: (bfNext as BackfillSymbolRow | null)?.yyyymm ?? null,
          recent_done_5min: recent5,
          eta_minutes: eta,
          last_attempted_at: (bfLastAttempt as { attempted_at: string | null } | null)?.attempted_at ?? null,
        };
      }

      const cron = runs.find((r) => {
        const params = (r.parameters && typeof r.parameters === 'object' && !Array.isArray(r.parameters))
          ? (r.parameters as Record<string, unknown>)
          : null;
        const trigger = params?.trigger;
        return r.run_mode === 'cron_weekly' || trigger === 'auto_after_backfill' || trigger === 'cron_nightly';
      });
      const lastCron = cron?.created_at ?? null;
      return { runs, items, failedBackfills, failedBackfillReasons, notifyLog, backfill, lastCron };
    },
    staleTime: 30_000,
  });

  const load = () => {
    queryClient.invalidateQueries({ queryKey: ['company', 'backtest-monitor'] });
    refetch();
  };

  const triggerNightly = async () => {
    setBusyAll('cron');
    try {
      const { error } = await supabase.functions.invoke('knowledge-backtest', {
        body: { mode: 'full', trigger: 'manual' },
      });
      if (error) throw error;
      toast({ title: '已觸發完整回測', description: '跑完會自動 Email 通知所有 admin。' });
      setTimeout(load, 2000);
    } catch (e: unknown) {
      toast({ title: '觸發失敗', description: errorMessage(e), variant: 'destructive' });
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
    } catch (e: unknown) {
      toast({ title: '通知失敗', description: errorMessage(e), variant: 'destructive' });
    } finally { setBusyAll(null); }
  };

  const retryItem = async (itemId: string | null, items: Record<string, { title: string }>) => {
    if (!itemId) return;
    setBusyId(itemId);
    try {
      const { error } = await supabase.functions.invoke('knowledge-backtest', {
        body: { mode: 'single', item_id: itemId },
      });
      if (error) throw error;
      toast({ title: '已重新執行', description: items[itemId]?.title ?? itemId });
      setTimeout(load, 1500);
    } catch (e: unknown) {
      toast({ title: '重試失敗', description: errorMessage(e), variant: 'destructive' });
    } finally { setBusyId(null); }
  };

  return {
    snapshot,
    loading: isFetching && !snapshot,
    busyId,
    busyAll,
    load,
    triggerNightly,
    sendNotify,
    retryItem,
  };
}
