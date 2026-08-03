/**
 * 30 日 K 線圖版面契約（單一資料源）。
 *
 * 為什麼存在：K 線 SVG 用 viewBox 100×30 + preserveAspectRatio="none"，
 * 垂直單位與 px 不是 1:1；過去 y-scale（PAD_Y = 2 units ≒ 4.8px @72px 高）
 * 與「有效壓力區」HTML 標籤（12px 行高）各自算各自的，
 * 導致最高 K 棒 top ≈ 5px、標籤 top ≈ 4px 直接重疊、看起來貼頂跑版。
 *
 * 契約：
 *   - 價格 plot 的 top/bottom safe inset 以 px 定義，能容納標籤與 marker 的視覺高度。
 *   - y-domain 只映射到 [topInset, height - bottomInset]，高低價自然留 headroom/footroom。
 *   - 壓力標籤一律排在壓力帶上緣「之上」，與最高 wick 至少 SAFE_GAP px。
 *
 * 守門：src/checkup/lib/klineLayout.test.ts、e2e/holdings-kline-top-safe-inset.spec.ts
 */

/** SVG viewBox 垂直單位數（水平為 100）。 */
export const KLINE_VIEWBOX_H = 30;
/** 壓力標籤行高（px），與元件 inline style lineHeight 對齊。 */
export const KLINE_LABEL_HEIGHT = 12;
/** 轉折 marker 視覺高度（px）：9px 字 + 3px anchor 位移。 */
export const KLINE_MARKER_HEIGHT = 12;
/** 任兩個視覺元素之間的最小安全間距（px）。 */
export const KLINE_SAFE_GAP = 6;
/** 價格 plot 上方保留（px）：容納標籤或 marker + 安全間距。 */
export const KLINE_TOP_SAFE_INSET = Math.max(KLINE_LABEL_HEIGHT, KLINE_MARKER_HEIGHT) + KLINE_SAFE_GAP + 4; // 22
/** 價格 plot 下方保留（px）：容納棒下 marker。 */
export const KLINE_BOTTOM_SAFE_INSET = KLINE_MARKER_HEIGHT + 4; // 16
/**
 * 圖表總高（px）。72 無法同時維持可讀 K 棒與 safe inset：
 * 72 - 22 - 16 = 34px plot 太扁，故小幅拉高到 92（plot 54px，優於原本 62 但會與標籤碰撞的版本）。
 * 量能副圖高度不變。
 */
export const KLINE_CHART_HEIGHT = 92;

export type KlineLayout = {
  /** 圖表總高（px） */
  height: number;
  topInset: number;
  bottomInset: number;
  /** 每 px 對應多少 viewBox 垂直單位 */
  unitPerPx: number;
  /** viewBox 單位的上下內縮 */
  padTop: number;
  padBottom: number;
  /** viewBox 單位的可用 plot 高度 */
  plotH: number;
  /** px 座標的 plot 上下界 */
  plotTopPx: number;
  plotBottomPx: number;
};

export function resolveKlineLayout(opts: {
  height?: number;
  topInset?: number;
  bottomInset?: number;
} = {}): KlineLayout {
  const height = Number.isFinite(opts.height) && (opts.height as number) > 0
    ? (opts.height as number)
    : KLINE_CHART_HEIGHT;
  const topInset = Number.isFinite(opts.topInset) ? Math.max(0, opts.topInset as number) : KLINE_TOP_SAFE_INSET;
  const bottomInset = Number.isFinite(opts.bottomInset)
    ? Math.max(0, opts.bottomInset as number)
    : KLINE_BOTTOM_SAFE_INSET;
  const unitPerPx = KLINE_VIEWBOX_H / height;
  const padTop = topInset * unitPerPx;
  const padBottom = bottomInset * unitPerPx;
  const plotH = Math.max(1, KLINE_VIEWBOX_H - padTop - padBottom);
  return {
    height,
    topInset,
    bottomInset,
    unitPerPx,
    padTop,
    padBottom,
    plotH,
    plotTopPx: topInset,
    plotBottomPx: height - bottomInset,
  };
}

/** 價格 → viewBox y（單位）。超出 [lo, hi] 會夾在 plot 邊界內。 */
export function yUnitsFor(
  value: number,
  domain: { lo: number; hi: number },
  layout: KlineLayout,
): number {
  const { lo, hi } = domain;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo <= 0 || !Number.isFinite(value)) {
    return KLINE_VIEWBOX_H / 2;
  }
  const ratio = Math.min(Math.max((value - lo) / (hi - lo), 0), 1);
  return KLINE_VIEWBOX_H - layout.padBottom - ratio * layout.plotH;
}

/** viewBox 單位 y → px。 */
export function unitsToPx(yUnits: number, layout: KlineLayout): number {
  return (yUnits / KLINE_VIEWBOX_H) * layout.height;
}

/**
 * 壓力標籤 top（px）：排在壓力帶上緣之上，並夾在圖表內。
 * 因為 zone 上緣 ≥ plotTopPx（= topInset），標籤底緣至少比最高 wick 高 SAFE_GAP。
 */
export function resistanceLabelTop(zoneTopUnits: number, layout: KlineLayout): number {
  const zoneTopPx = unitsToPx(zoneTopUnits, layout);
  const raw = zoneTopPx - KLINE_LABEL_HEIGHT - KLINE_SAFE_GAP;
  return Math.min(Math.max(raw, 0), Math.max(0, layout.height - KLINE_LABEL_HEIGHT));
}
