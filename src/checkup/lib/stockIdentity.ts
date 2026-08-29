/**
 * stockIdentity — 代號識別的**單一純函式資料源**（零 import、零 I/O）。
 *
 * 為什麼獨立成檔：`chipsRepository.ts` 內雖然已有 `normalizeStockCode` /
 * `isTaiwanStockCode`，但該檔 import `./gateway` 與 `@/lib/trafficTracker`，
 * 交易表單（手動新增成交）若直接 import 就會把籌碼 gateway 與 telemetry
 * 拉進交易 domain。這裡只放「字串 → 身分」的判斷，任何人都能安全引用。
 *
 * Universe 與全站既有定義對齊（`src/test/unit/stock-code-universe.test.ts` 有 parity 測）：
 *   TW：`/^\d{4,6}[A-Z]?$/`      ← `chipsRepository.isTaiwanStockCode` / `asset.ts` tw_stock.symbolRegex
 *   US：`/^[A-Z]{1,5}(\.[A-Z])?$/` ← `asset.ts` us_stock.symbolRegex / `signalFieldResolvers.US_CODE_ONLY_RE`
 */

export const TW_CODE_RE = /^\d{4,6}[A-Z]?$/;
export const US_CODE_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;

export type CodeMarket = 'TW' | 'US' | 'unknown';

/**
 * 代號正規化（單一資料源）：trim + 大寫。
 * 為什麼要 uppercase：`isTaiwanStockCode` 是大小寫敏感的 `/^\d{4,6}[A-Z]?$/`，
 * 曾發生 `00637l` 通過 hook 卻在 repository 被丟掉的靜默漏檔。
 */
export function normalizeStockCode(code: unknown): string {
  return String(code ?? '').trim().toUpperCase();
}

/** 台股代碼判定：4-6 位數字 + 可選單一大寫後綴（2330、00637L、911616）。 */
export function isTaiwanStockCode(code: string | undefined | null): boolean {
  if (!code) return false;
  return TW_CODE_RE.test(String(code).trim());
}

/** 美股 ticker 判定：1-5 個大寫字母 + 可選 `.X`（AMD、SOXL、BRK.B）。 */
export function isUsTicker(code: unknown): boolean {
  const c = normalizeStockCode(code);
  if (!c) return false;
  return US_CODE_RE.test(c);
}

/** 分類到目前整站實際支援的 universe；兩者皆不符 → `unknown`。 */
export function classifyCode(code: unknown): CodeMarket {
  const c = normalizeStockCode(code);
  if (!c) return 'unknown';
  if (isTaiwanStockCode(c)) return 'TW';
  if (isUsTicker(c)) return 'US';
  return 'unknown';
}

/** 格式是否為可接受的輸入（TW 或 US）。`12`、`TOOLONGX` 皆為 false。 */
export function isSupportedCode(code: unknown): boolean {
  return classifyCode(code) !== 'unknown';
}

export interface QtyRule {
  market: CodeMarket;
  /** 台股（含零股）一律整數股數；美股允許碎股。 */
  integerOnly: boolean;
  /** `<input inputMode>`。 */
  inputMode: 'numeric' | 'decimal';
  /** `<input step>`。 */
  step: '1' | 'any';
}

/**
 * 股數規則（`validateRow` 與 `computePreviewIssues` 共用，禁止兩處各寫一份）。
 * unknown（格式合法但不在 TW/US universe）比照美股寬鬆規則。
 */
export function qtyRuleFor(code: unknown): QtyRule {
  const market = classifyCode(code);
  const integerOnly = market === 'TW';
  return {
    market,
    integerOnly,
    inputMode: integerOnly ? 'numeric' : 'decimal',
    step: integerOnly ? '1' : 'any',
  };
}

/** 依 `qtyRuleFor` 檢查股數；回傳錯誤字串或 null。 */
export function validateQty(code: unknown, qty: unknown): string | null {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) {
    return qtyRuleFor(code).integerOnly ? '股數需為正整數' : '股數需大於 0';
  }
  if (qtyRuleFor(code).integerOnly && !Number.isInteger(n)) return '股數需為整數';
  return null;
}
