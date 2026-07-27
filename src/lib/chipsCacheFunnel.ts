/**
 * Chips 端到端快取漏斗計算（Phase F）
 * 從 traffic_events 事件序列還原「一次 drawer_open 走到哪一層停下」。
 *
 * 三層快取：
 *   L1 = 瀏覽器 memory（useTwChipsDetail 的 CACHE）
 *   L2 = Edge 記憶體 cache（tw-chips-detail 的 cacheGet/cacheSet + coalesce）
 *   L3 = DB 計算路徑（rollup 或 raw_fallback）
 *
 * 事件契約（既有）：
 *   chips_memory_hit   → L1 命中，流程結束
 *   chips_memory_miss  → L1 未命中，接著會發 chips_fetch_start
 *   chips_fetch_start  → 送 request 到 edge
 *   chips_fetch_done   → edge 回來；props.edge_cache ∈ {'hit','coalesced','miss'}
 *                        props.bsr_source ∈ {'rollup','raw_fallback',null}
 *   chips_fetch_error  → 失敗
 *
 * 端到端漏斗（source='drawer_open' 為分母）：
 *   drawer_open
 *     → L1 hit（瀏覽器省下 fetch）
 *     → 走網路
 *         → L2 hit（edge 記憶體命中，沒進 DB）
 *         → coalesced（同時多請求，合併一次 DB）
 *         → L3 miss（真正打 DB 計算）
 *             → rollup（正式 5/20/60 窗）
 *             → raw_fallback（僅 D1 raw）
 *             → no_data
 *         → error
 *
 * "有效命中率"（不打 DB 的比例）= (L1_hit + L2_hit + coalesced) / drawer_open
 */

export type ChipsEventName =
  | 'chips_memory_hit'
  | 'chips_memory_miss'
  | 'chips_fetch_start'
  | 'chips_fetch_done'
  | 'chips_fetch_error';

export interface ChipsEventRow {
  event_name: string;
  event_props: Record<string, unknown> | null;
}

export interface ChipsFunnelStats {
  /** 分母：source='drawer_open' 的事件數（L1 hit + fetch_start 加總） */
  drawer_open: number;
  /** L1 瀏覽器 memory 命中 */
  l1_hit: number;
  /** L1 miss，實際送到 edge 的 fetch */
  fetch_start: number;
  /** L2 edge memory 命中（edge_cache='hit'） */
  l2_hit: number;
  /** edge 端 coalesce 合併（edge_cache='coalesced'） */
  coalesced: number;
  /** L3 真正打 DB 計算（edge_cache='miss'） */
  db_compute: number;
  /** fetch_done 但缺 edge_cache 值 */
  edge_unknown: number;
  /** fetch_error 次數（source='drawer_open'） */
  errors: number;
  /** DB 命中 rollup（正式 5/20/60 窗） */
  db_rollup: number;
  /** DB 命中 raw_fallback（僅 D1 raw） */
  db_raw_fallback: number;
  /** DB 完全無資料 */
  db_no_data: number;

  /** 有效命中率（不觸 DB 的比例）= (l1_hit + l2_hit + coalesced) / drawer_open */
  effective_hit_ratio: number | null;
  /** L1 命中率 = l1_hit / drawer_open */
  l1_hit_ratio: number | null;
  /** L2 命中率（在 fetch_start 中）= l2_hit / fetch_start */
  l2_hit_ratio: number | null;
  /** DB 命中率（在 fetch_start 中）= db_compute / fetch_start */
  db_compute_ratio: number | null;
  /** DB rollup 占比（在 db_compute 中）= db_rollup / db_compute */
  rollup_ratio: number | null;
}

function safeRatio(num: number, den: number): number | null {
  if (den <= 0) return null;
  return num / den;
}

/**
 * 從事件列表計算端到端漏斗。
 * 只納入 source='drawer_open' 的事件（避免 manual_refetch/reconnect 稀釋分母）。
 */
export function computeChipsFunnel(rows: ChipsEventRow[]): ChipsFunnelStats {
  let l1_hit = 0;
  let fetch_start = 0;
  let l2_hit = 0;
  let coalesced = 0;
  let db_compute = 0;
  let edge_unknown = 0;
  let errors = 0;
  let db_rollup = 0;
  let db_raw_fallback = 0;
  let db_no_data = 0;

  for (const r of rows) {
    const props = (r.event_props ?? {}) as Record<string, unknown>;
    const src = String(props.source ?? '');
    if (src !== 'drawer_open') continue;

    switch (r.event_name) {
      case 'chips_memory_hit':
        l1_hit++;
        break;
      case 'chips_fetch_start':
        fetch_start++;
        break;
      case 'chips_fetch_done': {
        const ec = String(props.edge_cache ?? '');
        if (ec === 'hit') l2_hit++;
        else if (ec === 'coalesced') coalesced++;
        else if (ec === 'miss') {
          db_compute++;
          const bs = props.bsr_source;
          if (bs === 'rollup') db_rollup++;
          else if (bs === 'raw_fallback') db_raw_fallback++;
          else if (bs == null) db_no_data++;
        } else {
          edge_unknown++;
        }
        break;
      }
      case 'chips_fetch_error':
        errors++;
        break;
    }
  }

  const drawer_open = l1_hit + fetch_start;
  const effective_hits = l1_hit + l2_hit + coalesced;

  return {
    drawer_open,
    l1_hit,
    fetch_start,
    l2_hit,
    coalesced,
    db_compute,
    edge_unknown,
    errors,
    db_rollup,
    db_raw_fallback,
    db_no_data,
    effective_hit_ratio: safeRatio(effective_hits, drawer_open),
    l1_hit_ratio: safeRatio(l1_hit, drawer_open),
    l2_hit_ratio: safeRatio(l2_hit, fetch_start),
    db_compute_ratio: safeRatio(db_compute, fetch_start),
    rollup_ratio: safeRatio(db_rollup, db_compute),
  };
}

export function formatPct(r: number | null): string {
  if (r == null || !Number.isFinite(r)) return '—';
  return `${(r * 100).toFixed(1)}%`;
}
