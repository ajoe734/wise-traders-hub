/**
 * klineTooltip — K 棒 hover/觸控 tooltip 的純函式（抽屜 RangeBand 專用）
 * 只做座標換算與文字格式，不碰 DOM，方便單元測試。
 */

export type BarRect = { left: number; width: number };

/** 指標 X（clientX）→ 最近一根 K 棒索引；寬度為 0 或無資料回 null。 */
export function barIndexFromX(clientX: number, rect: BarRect, count: number): number | null {
  if (!rect || !(rect.width > 0) || !Number.isFinite(clientX)) return null;
  if (!Number.isFinite(count) || count < 1) return null;
  if (count === 1) return 0;
  const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
  return Math.round(ratio * (count - 1));
}

/**
 * 索引 → 十字線／tooltip 的 X 百分比（0-100）；根數 < 2 或無索引回 null。
 * padPct：繪圖區左右內縮的百分比（與 RangeBand 的 PAD_X 對齊），預設 0。
 */
export function barCenterPct(
  idx: number | null | undefined,
  count: number,
  padPct = 0,
): number | null {
  if (idx == null || !Number.isFinite(idx)) return null;
  if (!Number.isFinite(count) || count < 2) return null;
  const pad = Number.isFinite(padPct) ? Math.min(Math.max(padPct, 0), 40) : 0;
  return pad + (idx / (count - 1)) * (100 - pad * 2);
}


/** tooltip 是否要往左翻（避免超出右緣）。 */
export function shouldFlipTooltip(pct: number | null | undefined): boolean {
  return pct != null && Number.isFinite(pct) && pct > 60;
}

/** 日期格式：YYYY/MM/DD（專案日期憲法）。 */
export function fmtKlineDate(d: string | null | undefined): string {
  if (!d) return '—';
  const s = String(d);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : s.replace(/-/g, '/');
}

/** 價格格式：固定兩位小數，非有限數回破折號。 */
export function fmtKlineNum(v: number | null | undefined): string {
  return Number.isFinite(v as number) ? Number(v).toFixed(2) : '—';
}
