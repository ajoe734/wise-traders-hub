/**
 * popoverPlacement — K 棒 / 轉折 marker tooltip 的小型 anchor popover 定位（純函式）
 *
 * 契約：
 *  - 尺寸由內容決定，只給「上限」；不得產生 min-width / min-height 撐滿圖表。
 *  - 以 anchor 為中心，優先放上方；上方放不下改放下方（四邊碰撞避讓）。
 *  - 水平夾在 bounds 內（bounds = 圖表容器與 viewport 的交集），保證不裁切、不產生水平捲軸。
 */

export interface PopoverAnchor {
  /** anchor 中心 X（viewport 座標） */
  x: number;
  /** anchor 頂端 Y（viewport 座標） */
  top: number;
  /** anchor 底端 Y（viewport 座標） */
  bottom: number;
}

export interface PopoverBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PopoverPlacement {
  left: number;
  top: number;
  placement: 'above' | 'below';
}

/** tooltip 寬度上限：桌機 240px，手機 viewport - 24px。 */
export function popoverMaxWidth(viewportWidth: number, cap = 240): number {
  const vw = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : cap;
  return Math.max(160, Math.min(cap, vw - 24));
}

export function placePopover({
  anchor,
  size,
  bounds,
  gap = 8,
}: {
  anchor: PopoverAnchor;
  size: { width: number; height: number };
  bounds: PopoverBounds;
  gap?: number;
}): PopoverPlacement {
  const w = Math.max(0, size.width);
  const h = Math.max(0, size.height);

  const aboveTop = anchor.top - gap - h;
  const belowTop = anchor.bottom + gap;
  let placement: 'above' | 'below' = 'above';
  let top = aboveTop;
  if (aboveTop < bounds.top) {
    // 上方放不下 → 改放下方；下方也放不下時取「較不出界」的一側並夾住
    if (belowTop + h <= bounds.bottom || belowTop - bounds.top >= bounds.bottom - aboveTop) {
      placement = 'below';
      top = belowTop;
    }
  }
  top = Math.min(Math.max(top, bounds.top), Math.max(bounds.top, bounds.bottom - h));

  const maxLeft = Math.max(bounds.left, bounds.right - w);
  const left = Math.min(Math.max(anchor.x - w / 2, bounds.left), maxLeft);

  return { left, top, placement };
}
