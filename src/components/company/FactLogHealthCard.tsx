// P5: Fact-log 健康監控（tw_chip_fact + snapshot sealed 狀態）
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Database, AlertTriangle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhTW } from 'date-fns/locale';

type Summary = {
  total_rows: number;
  distinct_stocks: number;
  distinct_days: number;
  last_fact_at: string | null;
  broker_scraper_rows: number;
  finmind_batch_rows: number;
  finmind_per_stock_rows: number;
  legacy_migration_rows: number;
  sealed_days: number;
  eligible_days: number;
};

type HealthRow = {
  trade_date: string;
  lane: string;
  row_count: number;
  stock_count: number;
  broker_count: number;
  last_ingested_at: string | null;
  sealed: boolean;
  sealed_by_lane: string | null;
};

type Conflict = {
  trade_date: string;
  stock_id: string;
  broker_id: string;
  lanes: string[];
  lane_count: number;
  net_diff: number;
};

const LANE_LABEL: Record<string, { label: string; color: string }> = {
  broker_scraper:    { label: '爬蟲 A',      color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  finmind_batch:     { label: 'FinMind 批次', color: 'bg-blue-500/15 text-blue-700 dark:text-blue-300' },
  finmind_per_stock: { label: 'FinMind 個股', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  legacy_migration:  { label: '歷史遷移',    color: 'bg-muted text-muted-foreground' },
};

function fmtAgo(iso: string | null) {
  if (!iso) return '—';
  return formatDistanceToNow(new Date(iso), { locale: zhTW, addSuffix: true });
}

export function FactLogHealthCard() {
  const summary = useQuery({
    queryKey: ['company', 'chip-fact-summary'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('chip_fact_summary', { _days: 20 });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return row as Summary;
    },
    refetchInterval: 60_000,
  });

  const perDay = useQuery({
    queryKey: ['company', 'chip-fact-health'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('chip_fact_health').select('*').limit(200);
      if (error) throw error;
      return (data ?? []) as HealthRow[];
    },
    refetchInterval: 60_000,
  });

  const conflicts = useQuery({
    queryKey: ['company', 'chip-fact-conflicts'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('chip_fact_conflicts').select('*').limit(20);
      if (error) throw error;
      return (data ?? []) as Conflict[];
    },
    refetchInterval: 120_000,
  });

  const s = summary.data;
  const lastAgeHours = s?.last_fact_at ? (Date.now() - new Date(s.last_fact_at).getTime()) / 3_600_000 : null;
  const staleWarn = lastAgeHours != null && lastAgeHours >= 26;
  const sealedPct = s && s.eligible_days > 0 ? Math.round((s.sealed_days / s.eligible_days) * 100) : 0;

  // Pivot per-day rows to date -> lane -> count
  const byDate = new Map<string, Record<string, HealthRow>>();
  for (const r of (perDay.data ?? [])) {
    if (!byDate.has(r.trade_date)) byDate.set(r.trade_date, {});
    byDate.get(r.trade_date)![r.lane] = r;
  }
  const dates = Array.from(byDate.keys()).sort().reverse().slice(0, 20);

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Database className="h-4 w-4" />
        Fact-log 健康（tw_chip_fact · 近 20 日）
      </h2>

      {/* Summary tiles */}
      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">總筆數</CardTitle></CardHeader>
          <CardContent><div className="font-mono text-2xl">{s?.total_rows?.toLocaleString() ?? '—'}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">個股 / 天數</CardTitle></CardHeader>
          <CardContent><div className="font-mono text-2xl">{s?.distinct_stocks ?? '—'} / {s?.distinct_days ?? '—'}</div></CardContent>
        </Card>
        <Card className={staleWarn ? 'border-red-500' : ''}>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">最後寫入</CardTitle></CardHeader>
          <CardContent>
            <div className={`font-mono text-lg ${staleWarn ? 'text-red-600' : ''}`}>
              {fmtAgo(s?.last_fact_at ?? null)}
            </div>
            {staleWarn && <div className="text-xs text-red-600 mt-1">⚠ 超過 26h 未寫入</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Sealed 覆蓋率</CardTitle></CardHeader>
          <CardContent>
            <div className="font-mono text-2xl">{sealedPct}%</div>
            <div className="text-xs text-muted-foreground">{s?.sealed_days ?? 0} / {s?.eligible_days ?? 0} 日</div>
          </CardContent>
        </Card>
      </div>

      {/* Lane totals */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Lane 累積寫入（近 20 日）</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {(['broker_scraper','finmind_batch','finmind_per_stock','legacy_migration'] as const).map((k) => (
              <div key={k} className="rounded border p-2">
                <div className="text-xs text-muted-foreground">{LANE_LABEL[k].label}</div>
                <div className="font-mono text-lg">{(s?.[`${k}_rows` as keyof Summary] as number | undefined)?.toLocaleString() ?? 0}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Per-day pivot */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">每日 Lane 寫入分布</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b">
                <th className="py-1 pr-2">日期</th>
                <th className="pr-2">Sealed</th>
                {Object.entries(LANE_LABEL).map(([k, v]) => (
                  <th key={k} className="pr-2">{v.label}</th>
                ))}
                <th>最後寫入</th>
              </tr>
            </thead>
            <tbody>
              {dates.map((d) => {
                const row = byDate.get(d)!;
                const anySealed = Object.values(row).some((r) => r.sealed);
                const lastIng = Object.values(row).map((r) => r.last_ingested_at).filter(Boolean).sort().reverse()[0] ?? null;
                return (
                  <tr key={d} className="border-b last:border-0">
                    <td className="py-1 pr-2 font-mono">{d}</td>
                    <td className="pr-2">
                      {anySealed
                        ? <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">已封存</Badge>
                        : <Badge variant="outline">未封存</Badge>}
                    </td>
                    {Object.keys(LANE_LABEL).map((k) => (
                      <td key={k} className="pr-2 font-mono">
                        {row[k] ? `${row[k].row_count.toLocaleString()} (${row[k].stock_count} 檔)` : '—'}
                      </td>
                    ))}
                    <td className="text-muted-foreground">{fmtAgo(lastIng)}</td>
                  </tr>
                );
              })}
              {dates.length === 0 && (
                <tr><td colSpan={7} className="py-4 text-center text-muted-foreground">尚無資料</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Conflicts */}
      {conflicts.data && conflicts.data.length > 0 && (
        <Card className="border-amber-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Lane 衝突偵測（net_shares 差 ≥ 1000 股）
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-1 pr-2">日期</th>
                  <th className="pr-2">股票</th>
                  <th className="pr-2">分點</th>
                  <th className="pr-2">Lanes</th>
                  <th className="text-right">Net 差異</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.data.map((c, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1 pr-2 font-mono">{c.trade_date}</td>
                    <td className="pr-2 font-mono">{c.stock_id}</td>
                    <td className="pr-2 font-mono">{c.broker_id}</td>
                    <td className="pr-2">{c.lanes.join(', ')}</td>
                    <td className="text-right font-mono">{c.net_diff.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-xs text-muted-foreground mt-2">
              優先度：broker_scraper &gt; finmind_batch &gt; finmind_per_stock &gt; legacy_migration；materializer 已依此順序寫回 tw_bsr_daily。
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
