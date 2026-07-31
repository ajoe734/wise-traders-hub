/**
 * 價格軸標籤字寬 / 換行 / 錨定的純函式規則。
 *
 * 背景：標籤字串長度會變（「成本 507.00」、「目標 1,280.00 ↓12%」、成分名等），
 * 以往固定 `translateX(-50%) + maxWidth:92 + nowrap` 有兩個破口：
 *   1. 長字串被 ellipsis 截掉，讀不到目標價
 *   2. 不同長度導致視覺錯位／越界（clamp 用固定半寬過度保守）
 *
 * 這裡以「估算字寬」為單一資料源，統一決定：
 *   - maxWidth（隨容器寬縮放）
 *   - 是否換成兩行（wrap）
 *   - 錨定方式（貼左 / 置中 / 貼右）避免越界
 *   - lane 分配（依實際估寬判定碰撞，而非固定 26%）
 *
 * 所有函式皆為純函式，可單元測試；元件只負責量容器寬與套 style。
 */

export type LabelAnchor = 'start' | 'center' | 'end';

export interface LabelBox {
  /** 估算文字寬（px，未受 maxWidth 限制） */
  estWidth: number;
  /** 實際允許的最大寬（px） */
  maxWidth: number;
  /** 需要幾行才放得下（1 或 2） */
  lines: 1 | 2;
  /** 是否允許換行（lines === 2） */
  wrap: boolean;
  anchor: LabelAnchor;
  /** CSS left 值（px 字串） */
  left: string;
  /** CSS transform 值 */
  transform: string;
}

export const LABEL_FONT_SIZE = 10;
export const LABEL_LINE_HEIGHT = 12;
export const LABEL_MIN_MAX_WIDTH = 56;
export const LABEL_MAX_MAX_WIDTH = 112;
/** 標籤最寬不得超過容器的此比例，避免兩個標籤合計就撐滿整條軸 */
export const LABEL_WIDTH_RATIO = 0.42;
/** 同一 lane 內兩標籤之間至少要留的水平間距 */
export const LABEL_GAP_PX = 6;

const CJK = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;

/**
 * 估算單行文字寬度（px）。以字類給定寬度係數，足夠做版面決策，
 * 不需要 canvas measureText（保持純函式、可在 node 測試）。
 */
export function estimateLabelWidth(text: string, fontSize: number = LABEL_FONT_SIZE): number {
  if (!text) return 0;
  let units = 0;
  for (const ch of String(text)) {
    if (ch === ' ') units += 0.32;
    else if (CJK.test(ch)) units += 1.02;
    else if (/[0-9]/.test(ch)) units += 0.58;
    else if (/[.,%↑↓+-]/.test(ch)) units += 0.36;
    else units += 0.56;
  }
  // letterSpacing: 0.02em
  return units * fontSize * 1.02;
}

/** 依容器寬決定標籤 maxWidth（px）。 */
export function resolveMaxWidth(containerWidth: number): number {
  const w = Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : 320;
  return Math.round(
    Math.min(LABEL_MAX_MAX_WIDTH, Math.max(LABEL_MIN_MAX_WIDTH, w * LABEL_WIDTH_RATIO)),
  );
}

/**
 * 針對單一標籤解出字寬 / 換行 / 錨定。
 * 越界一律以「改變錨定」處理（貼左或貼右），不再用固定半寬 clamp，
 * 因此短標籤能真正對準刻度，長標籤也不會溢出容器。
 */
export function resolveLabelBox(input: {
  text: string;
  /** 標籤中心點百分比（0–100） */
  lxPct: number;
  containerWidth: number;
  fontSize?: number;
}): LabelBox {
  const { text, lxPct } = input;
  const fontSize = input.fontSize ?? LABEL_FONT_SIZE;
  const containerWidth =
    Number.isFinite(input.containerWidth) && input.containerWidth > 0 ? input.containerWidth : 320;
  const maxWidth = Math.min(resolveMaxWidth(containerWidth), containerWidth);
  const estWidth = estimateLabelWidth(text, fontSize);

  // 一行放不下 → 允許兩行（兩行仍放不下才由 ellipsis 收尾）
  const lines: 1 | 2 = estWidth > maxWidth ? 2 : 1;
  const renderWidth = Math.min(estWidth, maxWidth);
  const half = renderWidth / 2;

  const centerPx = (Math.min(100, Math.max(0, lxPct)) / 100) * containerWidth;
  let anchor: LabelAnchor = 'center';
  let leftPx = centerPx;
  if (centerPx - half < 0) {
    anchor = 'start';
    leftPx = 0;
  } else if (centerPx + half > containerWidth) {
    anchor = 'end';
    leftPx = containerWidth;
  }

  return {
    estWidth,
    maxWidth,
    lines,
    wrap: lines === 2,
    anchor,
    left: `${Math.round(leftPx * 100) / 100}px`,
    transform:
      anchor === 'center' ? 'translateX(-50%)' : anchor === 'end' ? 'translateX(-100%)' : 'none',
  };
}

export interface LaneInput {
  label: string;
  text: string;
  lxPct: number;
}

/**
 * 依「估算後的實際佔位區間」分配 lane（0 / 1），而不是固定百分比門檻。
 * 只要與同 lane 上一個標籤的區間（含 LABEL_GAP_PX）相交就換到另一個 lane。
 */
export function assignLanes(
  markers: LaneInput[],
  containerWidth: number,
  fontSize: number = LABEL_FONT_SIZE,
): Map<string, 0 | 1> {
  const sorted = [...markers].sort((a, b) => a.lxPct - b.lxPct);
  const lastRightByLane: Record<0 | 1, number> = { 0: -Infinity, 1: -Infinity };
  const result = new Map<string, 0 | 1>();
  for (const m of sorted) {
    const box = resolveLabelBox({ text: m.text, lxPct: m.lxPct, containerWidth, fontSize });
    const width = Math.min(box.estWidth, box.maxWidth);
    const centerPx = (Math.min(100, Math.max(0, m.lxPct)) / 100) *
      (containerWidth > 0 ? containerWidth : 320);
    const left =
      box.anchor === 'start' ? 0 : box.anchor === 'end' ? Math.max(0, (containerWidth || 320) - width) : centerPx - width / 2;
    const right = left + width;
    const lane: 0 | 1 = left >= lastRightByLane[0] + LABEL_GAP_PX ? 0 : 1;
    lastRightByLane[lane] = right;
    result.set(m.label, lane);
  }
  return result;
}

/** lane 對應的 top 位移（px）；兩行標籤的 lane 需要更高的行距。 */
export function laneTopOffset(lane: 0 | 1, anyWrapped: boolean): number {
  const laneHeight = anyWrapped ? LABEL_LINE_HEIGHT * 2 + 2 : LABEL_LINE_HEIGHT + 4;
  return lane * laneHeight;
}
