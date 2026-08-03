/**
 * volumeReadout — 走勢卡「讀值層」純函式
 *
 * 目的：把 tooltip 內容、壓力徽章狀態、量能 metric 清單抽成可測純函式，
 * 讓 UI 只負責排版，不再內嵌判讀邏輯（避免 hover / focus 兩條路徑內容不一致）。
 *
 * 單位契約：外部一律傳「張」(lots)；缺量為 null，不得以 0 代替。
 */

export interface ReadoutBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeLots?: number | null;
}

/** 滾動均量（張）；不足視窗回 null。 */
export function rollingLots(bars: ReadoutBar[], window: number): Array<number | null> {
  return bars.map((_, i) => {
    if (i + 1 < window) return null;
    const slice = bars.slice(i + 1 - window, i + 1);
    if (slice.some((b) => b?.volumeLots == null)) return null;
    const sum = slice.reduce((s, b) => s + Number(b.volumeLots), 0);
    return sum / window;
  });
}

export interface TooltipRow {
  key: string;
  label: string;
  value: string;
}

function n2(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : Number(v).toFixed(2);
}

function lots(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : `${Math.round(Number(v)).toLocaleString('zh-TW')} 張`;
}

/** hover 與 keyboard focus 共用同一份 tooltip 內容。 */
export function buildTooltipRows(
  bars: ReadoutBar[],
  idx: number,
  opts: {
    ma5?: Array<number | null>;
    ma20?: Array<number | null>;
    /** 命中日 → 型態文字；只有命中日才多一列，其他日期不增加資訊 */
    signals?: Record<string, string>;
  } = {},
): { date: string; rows: TooltipRow[] } | null {
  const b = bars?.[idx];
  if (!b) return null;
  const prev = idx > 0 ? bars[idx - 1] : null;
  const diff = prev && Number.isFinite(prev.close) && prev.close > 0 ? b.close - prev.close : null;
  const diffPct = diff != null && prev ? (diff / prev.close) * 100 : null;
  const ma5 = opts.ma5?.[idx] ?? null;
  const ma20 = opts.ma20?.[idx] ?? null;
  const vol = b.volumeLots ?? null;
  const rel = vol != null && ma20 != null && ma20 > 0 ? vol / ma20 : null;

  const rows: TooltipRow[] = [
    { key: 'oh', label: '開／高', value: `${n2(b.open)}　${n2(b.high)}` },
    { key: 'lc', label: '低／收', value: `${n2(b.low)}　${n2(b.close)}` },
    {
      key: 'chg',
      label: '漲跌',
      value: diff == null
        ? '—'
        : `${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(2)}（${diff >= 0 ? '+' : '−'}${Math.abs(diffPct as number).toFixed(2)}%）`,
    },
    { key: 'vol', label: '量', value: lots(vol) },
    { key: 'ma5', label: 'MA5 量', value: lots(ma5) },
    { key: 'ma20', label: 'MA20 量', value: lots(ma20) },
    { key: 'rel', label: '相對量能', value: rel == null ? '—' : `${rel.toFixed(2)} 倍` },
  ];
  const sig = opts.signals?.[b.date];
  if (sig) rows.push({ key: 'sig', label: '型態', value: sig });
  return { date: b.date, rows };
}

export type ResistanceBadgeState = 'reference' | 'cluster' | 'broken' | 'testing' | 'none';

export interface ResistanceBadge {
  state: ResistanceBadgeState;
  /** 文字標籤（不可只靠顏色分辨狀態） */
  label: string;
  /** 區間文字，無壓力時為 null */
  rangeText: string | null;
  /** 距離文字，無法計算時為 null */
  distanceText: string | null;
  /** 壓力是否落在目前 y 值域外（需以文字提示，不可壓縮 K 線刻度） */
  offDomain: boolean;
  offDomainText: string | null;
}

export function resistanceBadge({
  zone,
  distance,
  domain,
}: {
  zone: { lower: number; upper: number; basis: 'cluster' | 'reference' } | null;
  distance: { pct: number; state: 'below' | 'testing' | 'above' } | null;
  domain: { low: number; high: number } | null;
}): ResistanceBadge {
  if (!zone) {
    return {
      state: 'none', label: '近 60 日無明確壓力區',
      rangeText: null, distanceText: null, offDomain: false, offDomainText: null,
    };
  }
  const rangeText = zone.upper > zone.lower
    ? `${zone.lower.toFixed(2)}–${zone.upper.toFixed(2)}`
    : zone.lower.toFixed(2);

  let state: ResistanceBadgeState = zone.basis === 'cluster' ? 'cluster' : 'reference';
  let label = zone.basis === 'cluster' ? '有效壓力區' : '參考壓力';
  if (distance?.state === 'above') { state = 'broken'; label = '已突破'; }
  else if (distance?.state === 'testing') { state = 'testing'; label = '測試壓力'; }

  const distanceText = distance == null
    ? null
    : distance.state === 'testing'
      ? '測試中'
      : `${distance.state === 'above' ? '已站上' : '距離'} ${(Math.abs(distance.pct) * 100).toFixed(1)}%`;

  const offDomain = !!domain
    && Number.isFinite(domain.low) && Number.isFinite(domain.high)
    && (zone.lower > domain.high || zone.upper < domain.low);
  const offDomainText = offDomain
    ? (zone.lower > (domain as { high: number }).high ? '高於 30 日區間' : '低於 30 日區間')
    : null;

  return { state, label, rangeText, distanceText, offDomain, offDomainText };
}

export interface VolumeMetric {
  key: string;
  label: string;
  value: string;
}

/**
 * metric 清單：無量時只留壓力，不再堆 0/5、0/20、相對量能 — 等重複訊息。
 */
export function buildVolumeMetrics({
  stats,
  badge,
  hasVolume,
}: {
  stats: {
    todayLabel?: string; todayLots?: number | null;
    ma5Lots?: number | null; ma5Insufficient?: string | null;
    ma20Lots?: number | null; ma20Insufficient?: string | null;
    relVolume?: number | null;
  } | null;
  badge: ResistanceBadge;
  hasVolume: boolean;
}): VolumeMetric[] {
  const out: VolumeMetric[] = [];
  if (hasVolume && stats) {
    out.push({ key: 'today', label: stats.todayLabel || '今日量', value: lots(stats.todayLots) });
    out.push({
      key: 'ma5', label: '5 日均量',
      value: stats.ma5Lots == null ? (stats.ma5Insufficient || '—') : lots(stats.ma5Lots),
    });
    out.push({
      key: 'ma20', label: '20 日均量',
      value: stats.ma20Lots == null ? (stats.ma20Insufficient || '—') : lots(stats.ma20Lots),
    });
    out.push({
      key: 'rel', label: '相對量能',
      value: stats.relVolume == null ? '—' : `${stats.relVolume.toFixed(2)} 倍`,
    });
  }
  out.push({
    key: 'resistance',
    label: badge.label,
    value: [badge.rangeText, badge.distanceText, badge.offDomainText]
      .filter(Boolean).join('　') || '—',
  });
  return out;
}
