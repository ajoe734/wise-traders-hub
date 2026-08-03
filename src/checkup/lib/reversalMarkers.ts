/**
 * reversalMarkers — 把 `reversalSignals` 的結果映射成「K 棒上的歷史標記」（純函式）
 *
 * 為什麼獨立：標記位置、字形、aria 文案都必須可測試，且 UI 不得自行決定
 * 「哪一天有訊號、要不要顯示、顯示什麼字」。
 *
 * 規則：
 *  - 多方訊號畫在 K 棒「下方」，空方畫在「上方」。
 *  - pending / confirmed / failed 以「字形 + 文字」區分，不靠顏色。
 *  - failed 一律弱化並明寫「已失效」，且永遠不會是 active（摘要用）那一個。
 */
import {
  REVERSAL_LABEL,
  type ReversalSignal,
  type ReversalKind,
  type ReversalDirection,
  type ReversalState,
} from './reversalSignals';
import type { Bar } from './volumeAnalysis';

export const REVERSAL_STATE_LABEL: Record<ReversalState, string> = {
  pending: '待確認',
  confirmed: '已確認',
  failed: '已失效',
};

/** 形狀優先（不靠顏色）：實心＝已確認、空心＝待確認、叉＝已失效。 */
export const REVERSAL_GLYPH: Record<ReversalDirection, Record<ReversalState, string>> = {
  bullish: { pending: '△', confirmed: '▲', failed: '✕' },
  bearish: { pending: '▽', confirmed: '▼', failed: '✕' },
};

export interface ReversalMarker {
  index: number;
  date: string;
  kind: ReversalKind;
  direction: ReversalDirection;
  state: ReversalState;
  triggerPrice: number;
  /** 錨定價（多方＝該日最低、空方＝該日最高） */
  anchorPrice: number;
  /** 相對 K 棒的擺放位置 */
  placement: 'below' | 'above';
  glyph: string;
  label: string;
  stateLabel: string;
  ariaLabel: string;
  /** 是否為摘要選用的那一個（畫面最多一個 active） */
  active: boolean;
}

function priceText(v: number): string {
  return Number(v).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateText(d: string): string {
  return String(d || '').replace(/-/g, '/');
}

/** 確認條件文字（tooltip 與 aria 共用；不含型態名稱）。 */
export function reversalConfirmText(s: ReversalSignal): string {
  const verb = s.direction === 'bullish' ? '站上' : '跌破';
  if (s.state === 'confirmed') {
    return `已於 ${dateText(s.resolvedDate || '')} ${verb} ${priceText(s.triggerPrice)} 確認`;
  }
  if (s.state === 'failed') {
    const rev = s.direction === 'bullish' ? '跌破' : '站上';
    return `已失效（${dateText(s.resolvedDate || '')} 反向${rev}）`;
  }
  return `${verb} ${priceText(s.triggerPrice)} 才確認`;
}

/** tooltip 用：日期 → 「型態 · 狀態 · 確認條件」。 */
export function reversalTooltipByDate(
  signals: ReversalSignal[] | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of Array.isArray(signals) ? signals : []) {
    out[s.signalDate] =
      `${REVERSAL_LABEL[s.kind]} · ${REVERSAL_STATE_LABEL[s.state]} · ${reversalConfirmText(s)}`;
  }
  return out;
}

/**
 * 將訊號映射到「顯示中的 30 根 K 棒」座標。
 * 不在顯示區間內的訊號直接丟棄；同一天最多一個標記（取優先序較前者，
 * 由 detectReversalSignals 的輸出順序決定）。
 */
export function buildReversalMarkers(
  signals: ReversalSignal[] | null | undefined,
  displayBars: Array<Bar | { date?: string; high: number; low: number }> | null | undefined,
  active?: ReversalSignal | null,
): ReversalMarker[] {
  const bars = Array.isArray(displayBars) ? displayBars : [];
  if (!bars.length) return [];
  const idxByDate = new Map<string, number>();
  bars.forEach((b, i) => {
    const d = String((b as any)?.date || '');
    if (d && !idxByDate.has(d)) idxByDate.set(d, i);
  });

  const seen = new Set<string>();
  const out: ReversalMarker[] = [];
  for (const s of Array.isArray(signals) ? signals : []) {
    const i = idxByDate.get(s.signalDate);
    if (i == null || seen.has(s.signalDate)) continue;
    const bar = bars[i] as any;
    if (!Number.isFinite(bar?.high) || !Number.isFinite(bar?.low)) continue;
    seen.add(s.signalDate);
    const placement = s.direction === 'bullish' ? 'below' : 'above';
    const label = REVERSAL_LABEL[s.kind];
    const stateLabel = REVERSAL_STATE_LABEL[s.state];
    out.push({
      index: i,
      date: s.signalDate,
      kind: s.kind,
      direction: s.direction,
      state: s.state,
      triggerPrice: s.triggerPrice,
      anchorPrice: placement === 'below' ? Number(bar.low) : Number(bar.high),
      placement,
      glyph: REVERSAL_GLYPH[s.direction][s.state],
      label,
      stateLabel,
      ariaLabel: `${dateText(s.signalDate)} ${label} ${stateLabel}，${reversalConfirmText(s)}`,
      active: !!active && active.signalDate === s.signalDate && active.kind === s.kind,
    });
  }
  return out.sort((a, b) => a.index - b.index);
}
