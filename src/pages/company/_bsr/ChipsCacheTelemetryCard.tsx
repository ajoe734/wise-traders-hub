import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { computeChipsFunnel, formatPct } from '@/lib/chipsCacheFunnel';


/**
 * Chips Cache Telemetry — Step 0 量測卡片
 * 讀取 traffic_events 內 chips_* 事件，計算 24h 命中率與延遲分佈。
 * 事件由 src/checkup/hooks/useTwChipsDetail.ts 送出。
 */

const CHIPS_EVENTS = [
  'chips_memory_hit',
  'chips_memory_miss',
  'chips_fetch_start',
  'chips_fetch_done',
  'chips_fetch_error',
] as const;

interface Row {
  event_name: string;
  event_props: Record<string, unknown> | null;
  occurred_at: string;
}

function pct(n: number, d: number): string {
  if (!d) return '—';
  return `${((n / d) * 100).toFixed(1)}%`;
}

function percentile(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function ChipsCacheTelemetryCard() {
  const sinceIso = useMemo(() => new Date(Date.now() - 24 * 3600_000).toISOString(), []);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['chips-cache-telemetry', sinceIso],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from('traffic_events')
        .select('event_name, event_props, occurred_at')
        .in('event_name', CHIPS_EVENTS as unknown as string[])
        .gte('occurred_at', sinceIso)
        .limit(20000);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    staleTime: 60_000,
  });

  const stats = useMemo(() => {
    const rows = data ?? [];
    const byName: Record<string, Row[]> = {};
    for (const r of rows) {
      (byName[r.event_name] ||= []).push(r);
    }
    const hits = byName['chips_memory_hit']?.length ?? 0;
    const misses = byName['chips_memory_miss']?.length ?? 0;
    const done = byName['chips_fetch_done'] ?? [];
    const errors = byName['chips_fetch_error']?.length ?? 0;
    const starts = byName['chips_fetch_start']?.length ?? 0;

    const missReasons: Record<string, number> = {};
    for (const r of byName['chips_memory_miss'] ?? []) {
      const reason = String((r.event_props as any)?.reason ?? 'unknown');
      missReasons[reason] = (missReasons[reason] ?? 0) + 1;
    }

    const edgeCacheDist: Record<string, number> = {};
    const durations: number[] = [];
    const freshnessDist: Record<string, number> = {};
    for (const r of done) {
      const props = (r.event_props ?? {}) as any;
      const ec = String(props.edge_cache ?? 'unknown');
      edgeCacheDist[ec] = (edgeCacheDist[ec] ?? 0) + 1;
      if (typeof props.duration_ms === 'number') durations.push(props.duration_ms);
      const fs = String(props.bsr_freshness_status ?? 'unknown');
      freshnessDist[fs] = (freshnessDist[fs] ?? 0) + 1;
    }

    const sourceDist: Record<string, number> = {};
    for (const r of byName['chips_fetch_start'] ?? []) {
      const src = String((r.event_props as any)?.source ?? 'unknown');
      sourceDist[src] = (sourceDist[src] ?? 0) + 1;
    }

    const total = hits + misses;
    const openCount = sourceDist['drawer_open'] ?? 0;
    const requestsPerOpen = openCount > 0 ? (starts / openCount) : null;

    // Phase F：端到端漏斗（只算 source='drawer_open'）
    const funnel = computeChipsFunnel(
      rows.map((r) => ({ event_name: r.event_name, event_props: r.event_props })),
    );

    return {
      hits, misses, total, errors, starts,
      memoryHitRatio: pct(hits, total),
      edgeHitRatio: pct(edgeCacheDist['hit'] ?? 0, done.length),
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      missReasons, edgeCacheDist, freshnessDist, sourceDist,
      requestsPerOpen,
      funnel,
    };
  }, [data]);


  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-medium">Chips Cache Telemetry（24h）</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            衡量籌碼抽屜 memory / edge KV 快取效益，作為多層快取優化的證據依據
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {isFetching ? '更新中…' : '重新整理'}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div className="rounded border p-2">
          <div className="text-muted-foreground">Memory 命中率</div>
          <div className="text-lg font-semibold">{stats.memoryHitRatio}</div>
          <div className="text-muted-foreground mt-0.5">hit {stats.hits} / miss {stats.misses}</div>
        </div>
        <div className="rounded border p-2">
          <div className="text-muted-foreground">Edge KV 命中率</div>
          <div className="text-lg font-semibold">{stats.edgeHitRatio}</div>
          <div className="text-muted-foreground mt-0.5">
            hit {stats.edgeCacheDist['hit'] ?? 0} / miss {stats.edgeCacheDist['miss'] ?? 0}
          </div>
        </div>
        <div className="rounded border p-2">
          <div className="text-muted-foreground">Fetch 延遲 P50 / P95</div>
          <div className="text-lg font-semibold font-mono">
            {(stats.p50 / 1000).toFixed(2)}s / {(stats.p95 / 1000).toFixed(2)}s
          </div>
          <div className="text-muted-foreground mt-0.5">錯誤 {stats.errors}</div>
        </div>
        <div className="rounded border p-2">
          <div className="text-muted-foreground">每次開抽屜請求次數</div>
          <div className="text-lg font-semibold font-mono">
            {stats.requestsPerOpen == null ? '—' : stats.requestsPerOpen.toFixed(2)}
          </div>
          <div className="text-muted-foreground mt-0.5">
            drawer_open {stats.sourceDist['drawer_open'] ?? 0}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 text-xs">
        <div>
          <div className="text-muted-foreground mb-1">Miss 原因分佈</div>
          <div className="space-y-0.5 font-mono">
            {Object.entries(stats.missReasons).length === 0 && (
              <div className="text-muted-foreground">無資料</div>
            )}
            {Object.entries(stats.missReasons)
              .sort(([, a], [, b]) => b - a)
              .map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span>{k}</span><span>{v}</span>
                </div>
              ))}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground mb-1">請求來源分佈</div>
          <div className="space-y-0.5 font-mono">
            {Object.entries(stats.sourceDist).length === 0 && (
              <div className="text-muted-foreground">無資料</div>
            )}
            {Object.entries(stats.sourceDist).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span>{k}</span><span>{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground mb-1">BSR 新鮮度分佈（fetch_done）</div>
          <div className="space-y-0.5 font-mono">
            {Object.entries(stats.freshnessDist).length === 0 && (
              <div className="text-muted-foreground">無資料</div>
            )}
            {Object.entries(stats.freshnessDist).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span>{k}</span><span>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Phase F：端到端漏斗 —— 只算 source='drawer_open' */}
      <div className="mt-5 rounded border p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">端到端漏斗（drawer_open）</div>
          <div className="text-[11px] text-muted-foreground">
            分母 = {stats.funnel.drawer_open} 次開抽屜
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div className="rounded border p-2">
            <div className="text-muted-foreground">有效命中率（不觸 DB）</div>
            <div className="text-lg font-semibold">{formatPct(stats.funnel.effective_hit_ratio)}</div>
            <div className="text-muted-foreground mt-0.5 font-mono">
              L1 {stats.funnel.l1_hit} + L2 {stats.funnel.l2_hit} + coalesced {stats.funnel.coalesced}
            </div>
          </div>
          <div className="rounded border p-2">
            <div className="text-muted-foreground">L1 瀏覽器命中率</div>
            <div className="text-lg font-semibold">{formatPct(stats.funnel.l1_hit_ratio)}</div>
            <div className="text-muted-foreground mt-0.5 font-mono">
              {stats.funnel.l1_hit} / {stats.funnel.drawer_open}
            </div>
          </div>
          <div className="rounded border p-2">
            <div className="text-muted-foreground">L2 Edge 命中率（送 fetch 中）</div>
            <div className="text-lg font-semibold">{formatPct(stats.funnel.l2_hit_ratio)}</div>
            <div className="text-muted-foreground mt-0.5 font-mono">
              {stats.funnel.l2_hit} / {stats.funnel.fetch_start}
            </div>
          </div>
          <div className="rounded border p-2">
            <div className="text-muted-foreground">L3 DB 計算率（送 fetch 中）</div>
            <div className="text-lg font-semibold">{formatPct(stats.funnel.db_compute_ratio)}</div>
            <div className="text-muted-foreground mt-0.5 font-mono">
              {stats.funnel.db_compute} / {stats.funnel.fetch_start}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="rounded border p-2">
            <div className="text-muted-foreground mb-1">DB 計算結果分佈</div>
            <div className="space-y-0.5 font-mono">
              <div className="flex justify-between"><span>rollup（正式 5/20/60）</span><span>{stats.funnel.db_rollup}</span></div>
              <div className="flex justify-between"><span>raw_fallback（僅 D1）</span><span>{stats.funnel.db_raw_fallback}</span></div>
              <div className="flex justify-between"><span>no_data</span><span>{stats.funnel.db_no_data}</span></div>
              <div className="flex justify-between text-muted-foreground mt-1">
                <span>rollup 占比</span><span>{formatPct(stats.funnel.rollup_ratio)}</span>
              </div>
            </div>
          </div>
          <div className="rounded border p-2">
            <div className="text-muted-foreground mb-1">漏斗流量（drawer_open → …）</div>
            <div className="space-y-0.5 font-mono">
              <div className="flex justify-between"><span>drawer_open</span><span>{stats.funnel.drawer_open}</span></div>
              <div className="flex justify-between"><span>→ L1 hit（停）</span><span>{stats.funnel.l1_hit}</span></div>
              <div className="flex justify-between"><span>→ fetch → L2 hit（停）</span><span>{stats.funnel.l2_hit}</span></div>
              <div className="flex justify-between"><span>→ fetch → coalesced（停）</span><span>{stats.funnel.coalesced}</span></div>
              <div className="flex justify-between"><span>→ fetch → DB compute</span><span>{stats.funnel.db_compute}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>error</span><span>{stats.funnel.errors}</span></div>
              {stats.funnel.edge_unknown > 0 && (
                <div className="flex justify-between text-muted-foreground"><span>edge_unknown</span><span>{stats.funnel.edge_unknown}</span></div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge variant="outline" className="text-[10px]">Phase F：端到端命中率</Badge>
        <Badge variant="outline" className="text-[10px]">來源：traffic_events</Badge>
        <Badge variant="outline" className="text-[10px]">分層：L1 memory / L2 edge / L3 DB</Badge>
      </div>

    </Card>
  );
}
