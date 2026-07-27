import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

/**
 * Keep-warm Waves Observability (Phase D)
 * 讀取 tw_bsr_keepwarm_metrics — 每次三波 orchestrator 執行寫入一筆。
 * 展示：最近 7 天各 trade_date 三波（1/2/3）封盤狀況、延遲、fallback 檔數、錯誤。
 */

interface Row {
  id: string;
  trade_date: string;
  wave: number;
  status: string;
  sealed: boolean;
  sealed_by_lane: string | null;
  coverage_stocks: number;
  coverage_brokers: number;
  fallback_used_count: number;
  duration_ms: number;
  error: string | null;
  started_at: string;
}

const WAVES = [1, 2, 3] as const;

function pickLatest(rows: Row[], date: string, wave: number): Row | null {
  const filtered = rows.filter(r => r.trade_date === date && r.wave === wave);
  if (!filtered.length) return null;
  filtered.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  return filtered[0];
}

function statusBadge(row: Row | null) {
  if (!row) {
    return <Badge variant="outline" className="text-[10px]">未執行</Badge>;
  }
  if (row.status === 'error') {
    return <Badge variant="destructive" className="text-[10px]">失敗</Badge>;
  }
  if (row.sealed) {
    return <Badge className="text-[10px] bg-emerald-600 hover:bg-emerald-600">已封盤</Badge>;
  }
  if (row.status === 'partial') {
    return <Badge variant="secondary" className="text-[10px]">部分覆蓋</Badge>;
  }
  return <Badge variant="outline" className="text-[10px]">{row.status}</Badge>;
}

export function KeepWarmWavesCard() {
  const sinceIso = useMemo(
    () => new Date(Date.now() - 7 * 24 * 3600_000).toISOString(),
    [],
  );

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['keepwarm-waves', sinceIso],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from('tw_bsr_keepwarm_metrics')
        .select(
          'id, trade_date, wave, status, sealed, sealed_by_lane, coverage_stocks, coverage_brokers, fallback_used_count, duration_ms, error, started_at',
        )
        .gte('started_at', sinceIso)
        .order('started_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    staleTime: 60_000,
  });

  const { dates, rows, summary } = useMemo(() => {
    const rows = data ?? [];
    const dateSet = new Set(rows.map(r => r.trade_date));
    const dates = Array.from(dateSet).sort((a, b) => (a < b ? 1 : -1)).slice(0, 7);

    let totalRuns = 0;
    let sealedRuns = 0;
    let errorRuns = 0;
    let totalDuration = 0;
    let fallbackSum = 0;
    for (const r of rows) {
      totalRuns++;
      if (r.status === 'error') errorRuns++;
      if (r.sealed) sealedRuns++;
      totalDuration += r.duration_ms || 0;
      fallbackSum += r.fallback_used_count || 0;
    }
    const avgDurationMs = totalRuns ? Math.round(totalDuration / totalRuns) : 0;
    const sealRatio = totalRuns ? ((sealedRuns / totalRuns) * 100).toFixed(1) + '%' : '—';
    const errorRatio = totalRuns ? ((errorRuns / totalRuns) * 100).toFixed(1) + '%' : '—';

    return {
      dates,
      rows,
      summary: {
        totalRuns,
        sealRatio,
        errorRatio,
        avgDurationMs,
        fallbackSum,
      },
    };
  }, [data]);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-medium">Keep-warm 三波觀測（7 天）</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            來自 <span className="font-mono">tw_bsr_keepwarm_metrics</span>；每次 orchestrator 執行寫入一筆
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {isFetching ? '更新中…' : '重新整理'}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-4">
        <div className="rounded border p-2">
          <div className="text-muted-foreground">總執行次數</div>
          <div className="text-lg font-semibold font-mono">{summary.totalRuns}</div>
        </div>
        <div className="rounded border p-2">
          <div className="text-muted-foreground">封盤成功率</div>
          <div className="text-lg font-semibold font-mono">{summary.sealRatio}</div>
        </div>
        <div className="rounded border p-2">
          <div className="text-muted-foreground">錯誤率</div>
          <div className="text-lg font-semibold font-mono">{summary.errorRatio}</div>
        </div>
        <div className="rounded border p-2">
          <div className="text-muted-foreground">平均延遲</div>
          <div className="text-lg font-semibold font-mono">
            {(summary.avgDurationMs / 1000).toFixed(2)}s
          </div>
          <div className="text-muted-foreground mt-0.5">fallback 用 {summary.fallbackSum} 檔次</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-muted-foreground text-left">
              <th className="py-1.5 pr-3">交易日</th>
              {WAVES.map(w => (
                <th key={w} className="py-1.5 px-2">Wave {w}</th>
              ))}
              <th className="py-1.5 px-2">覆蓋 / 封盤</th>
              <th className="py-1.5 px-2">Fallback</th>
            </tr>
          </thead>
          <tbody>
            {dates.length === 0 && (
              <tr>
                <td colSpan={2 + WAVES.length + 1} className="py-3 text-muted-foreground text-center">
                  尚無資料 — 等下一波 orchestrator 執行後會出現
                </td>
              </tr>
            )}
            {dates.map(date => {
              const perWave = WAVES.map(w => pickLatest(rows, date, w));
              const anySealed = perWave.find(r => r?.sealed) ?? null;
              const latest = perWave.filter(Boolean).sort(
                (a, b) => ((a!.started_at < b!.started_at) ? 1 : -1),
              )[0] ?? null;
              return (
                <tr key={date} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-3 font-mono">{date.replace(/-/g, '/')}</td>
                  {perWave.map((row, i) => (
                    <td key={i} className="py-2 px-2">
                      <div className="flex flex-col gap-0.5">
                        {statusBadge(row)}
                        {row && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {(row.duration_ms / 1000).toFixed(2)}s
                          </span>
                        )}
                        {row?.error && (
                          <span
                            className="text-[10px] text-destructive truncate max-w-[160px]"
                            title={row.error}
                          >
                            {row.error}
                          </span>
                        )}
                      </div>
                    </td>
                  ))}
                  <td className="py-2 px-2 font-mono">
                    {latest ? (
                      <>
                        {latest.coverage_stocks} 檔 / {latest.coverage_brokers} 券商
                        {anySealed?.sealed_by_lane && (
                          <div className="text-[10px] text-muted-foreground">
                            封盤 lane：{anySealed.sealed_by_lane}
                          </div>
                        )}
                      </>
                    ) : '—'}
                  </td>
                  <td className="py-2 px-2 font-mono">
                    {latest ? `${latest.fallback_used_count} 檔` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge variant="outline" className="text-[10px]">Phase D：三波可觀測性</Badge>
        <Badge variant="outline" className="text-[10px]">來源：tw_bsr_keepwarm_metrics</Badge>
        <Badge variant="outline" className="text-[10px]">寫入者：tw-chips-orchestrator</Badge>
      </div>
    </Card>
  );
}
