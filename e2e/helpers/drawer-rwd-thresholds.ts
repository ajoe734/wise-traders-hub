/**
 * Drawer RWD 幾何守門 · 集中閾值（CI-strict）
 *
 * 原本各 spec 只做「overflow > tolerance 就 fail」的軟斷言，
 * 這裡再加兩層硬門檻：
 *
 *   1. OVERFLOW_HARD_CAP_PX — 任何單一 finding 的 overflow 像素上限。
 *      CI 環境更嚴（2.0px），本機開發放寬（3.0px）。
 *      超出就直接 throw，附上該 finding 詳細 rect / rootBox / kind / text。
 *
 *   2. VOLATILITY_MAX_RANGE_PX — 同一組測試（不同 breakpoint / 不同 scroll 位置）
 *      的 maxOverflow 極差上限，用來偵測「某個斷點特別會爆但其他斷點還好」
 *      這類「不穩定」的溢出回歸，即使個別值都低於 hard cap 也會擋下來。
 *
 * VolatilityTracker 用法：
 *   const tracker = new VolatilityTracker('rwd-extreme scroll positions');
 *   tracker.record(label, maxOverflow);   // 每個 sub-scenario 都記一筆
 *   tracker.assertRange();                // 在 test 尾端或 afterAll 呼叫
 *
 * 只在 CI 收緊；本機仍能跑，但門檻寬一點以吸收字型 / DPR 差異。
 */
import type { OverflowFinding } from './drawer-overflow-annotate';

const IS_CI = !!process.env.CI;

export const OVERFLOW_TOLERANCE_PX = 1.5;

/** 任何單一 overflow 觀測值的絕對上限。超出視為嚴重回歸，立即失敗。 */
export const OVERFLOW_HARD_CAP_PX = IS_CI ? 2.0 : 3.0;

/**
 * 同一組 sub-scenario（例：3 個 scroll 位置、多個 stress preset）
 * 之間 maxOverflow 的極差（max - min）上限。
 * 用來抓「某個位置突然變得比其他位置多好幾 px」的不穩定 layout 回歸。
 */
export const VOLATILITY_MAX_RANGE_PX = IS_CI ? 1.0 : 1.5;

/** 少於這個樣本數不做波動檢查（只有一筆時談不上「波動」）。 */
export const VOLATILITY_MIN_SAMPLES = 2;

/**
 * 從一組 findings 取出最大 overflow 值（無 findings 回 0）。
 * findings 本身已是 overflow > tolerance 的子集，用於硬上限比對。
 */
export function findingsMaxOverflow(findings: OverflowFinding[]): number {
  if (!findings || findings.length === 0) return 0;
  return findings.reduce((m, f) => (f.overflow > m ? f.overflow : m), 0);
}

/**
 * 硬上限斷言 — 任何 finding.overflow 超過 OVERFLOW_HARD_CAP_PX 直接 throw。
 * 錯誤訊息會列出所有超上限的 finding，方便直接對照 annotate 截圖。
 */
export function assertOverflowHardCap(
  findings: OverflowFinding[],
  label: string,
  cap: number = OVERFLOW_HARD_CAP_PX,
): void {
  const breaches = (findings ?? []).filter((f) => f.overflow > cap);
  if (breaches.length === 0) return;
  const lines = breaches.map((f, i) =>
    `  #${i + 1} +${f.overflow.toFixed(2)}px  [${f.kind}${f.tag ? `:${f.tag}` : ''}] ` +
    `"${(f.text || '').slice(0, 60)}"  rect=(L${f.left.toFixed(1)},R${f.right.toFixed(1)}) ` +
    `root=(L${f.rootLeft.toFixed(1)},R${f.rootRight.toFixed(1)})`,
  );
  throw new Error(
    `[${label}] overflow HARD CAP breached: ${breaches.length} finding(s) > ${cap.toFixed(2)}px ` +
    `(CI=${IS_CI ? 'true' : 'false'})\n${lines.join('\n')}`,
  );
}

/**
 * 一組 sub-scenario 的 maxOverflow 樣本收集器 + 波動極差斷言。
 * scope 只是錯誤訊息用的標籤，不影響邏輯。
 */
export class VolatilityTracker {
  private readonly scope: string;
  private readonly samples: Array<{ label: string; value: number }> = [];

  constructor(scope: string) {
    this.scope = scope;
  }

  record(label: string, value: number): void {
    this.samples.push({ label, value: Number.isFinite(value) ? Math.max(0, value) : 0 });
  }

  values(): ReadonlyArray<{ label: string; value: number }> {
    return this.samples;
  }

  /**
   * 若樣本數 ≥ VOLATILITY_MIN_SAMPLES，檢查 max - min ≤ VOLATILITY_MAX_RANGE_PX。
   * 超過就 throw 並列出每筆樣本，方便看是哪個 label 拉高極差。
   */
  assertRange(maxRange: number = VOLATILITY_MAX_RANGE_PX): void {
    if (this.samples.length < VOLATILITY_MIN_SAMPLES) return;
    const values = this.samples.map((s) => s.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    if (range <= maxRange) return;
    const rows = this.samples
      .map((s) => `  ${s.label.padEnd(24)} maxOverflow=${s.value.toFixed(2)}px`)
      .join('\n');
    throw new Error(
      `[${this.scope}] overflow VOLATILITY breached: range=${range.toFixed(2)}px ` +
      `(min=${min.toFixed(2)} max=${max.toFixed(2)}) > ${maxRange.toFixed(2)}px ` +
      `(CI=${IS_CI ? 'true' : 'false'})\n${rows}`,
    );
  }
}

export const RWD_THRESHOLDS_META = {
  IS_CI,
  OVERFLOW_TOLERANCE_PX,
  OVERFLOW_HARD_CAP_PX,
  VOLATILITY_MAX_RANGE_PX,
  VOLATILITY_MIN_SAMPLES,
} as const;
