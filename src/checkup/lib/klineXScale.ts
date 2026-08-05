/**
 * klineXScale — 30 日 K 線的水平版面契約（單一資料源）。
 *
 * 為什麼存在：舊版把 x 直接算成 `i / (N - 1)`，於是上游只回 2 根時，
 * 兩根 K 棒被分置圖的最左與最右、bar 寬度暴增成巨柱（3491 事故畫面）。
 *
 * 契約：
 *   - 一律以固定 30 個 slot 佈局（資料多於 30 根時以實際根數為 slot 數）。
 *   - 資料靠右對齊：最新一根永遠落在最右 slot，時間軸語意固定。
 *   - bar 寬度只由 slot 間距決定，與資料筆數無關，且有上限。
 *
 * 守門：src/checkup/lib/klineXScale.test.ts
 */

/** 固定時間軸格數（= 30 日走勢）。 */
export const KLINE_SLOTS = 30;
/** K 棒／量柱寬度上下限（viewBox 水平單位，viewBox 寬 100）。 */
export const KLINE_BAR_MIN_W = 0.8;
export const KLINE_BAR_MAX_W = 3.2;

export interface KlineXScale {
  /** 實際資料筆數 */
  count: number;
  /** 時間軸格數（>= KLINE_SLOTS） */
  slotCount: number;
  /** 繪圖區左右內縮（百分比） */
  padX: number;
  /** slot 間距（viewBox 單位） */
  step: number;
  /** K 棒實體寬（viewBox 單位） */
  bodyW: number;
  /** 資料索引 → x 中心（viewBox 單位 = 百分比） */
  xAt: (index: number) => number;
  /** 0–1 的水平比例 → 最近的資料索引（超出資料區夾在兩端） */
  indexAtRatio: (ratio: number) => number | null;
}

export function resolveKlineXScale(opts: {
  count: number;
  padX?: number;
  slots?: number;
  bodyRatio?: number;
}): KlineXScale {
  const count = Math.max(0, Math.floor(Number(opts.count) || 0));
  const padX = Number.isFinite(opts.padX) ? Math.min(Math.max(opts.padX as number, 0), 40) : 0;
  const slots = Number.isFinite(opts.slots) && (opts.slots as number) > 1
    ? Math.floor(opts.slots as number)
    : KLINE_SLOTS;
  const slotCount = Math.max(slots, count, 2);
  const plotW = 100 - padX * 2;
  const step = plotW / (slotCount - 1);
  const ratio = Number.isFinite(opts.bodyRatio) ? (opts.bodyRatio as number) : 0.6;
  const bodyW = Math.max(KLINE_BAR_MIN_W, Math.min(KLINE_BAR_MAX_W, step * ratio));
  // 靠右對齊：最後一根資料 = 最後一個 slot
  const offset = slotCount - count;

  const xAt = (index: number) => {
    const i = Math.min(Math.max(Math.round(Number(index) || 0), 0), Math.max(0, count - 1));
    return padX + (offset + i) * step;
  };

  const indexAtRatio = (r: number) => {
    if (!count) return null;
    if (!Number.isFinite(r)) return null;
    const clamped = Math.min(Math.max(r, 0), 1);
    const slot = Math.round(clamped * (slotCount - 1));
    return Math.min(Math.max(slot - offset, 0), count - 1);
  };

  return { count, slotCount, padX, step, bodyW, xAt, indexAtRatio };
}
