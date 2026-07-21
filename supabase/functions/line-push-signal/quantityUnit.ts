/**
 * LINE 推播單位單一資料源（憲法對齊 src/lib/asset.ts::sanitizeAssetQuantityUnit）
 *
 * 憲法：
 *   - us_stock  → 「股」（絕不能是「張」）
 *   - us_future → 「口」
 *   - us_option → 「口」
 *   - crypto    → 「顆」
 *   - tw_stock  → 「張」
 *
 * 為何：line-push-signal 只從 expert_signals 拿 `quantity_unit`，
 * 若上游草稿寫錯／缺值，直接印出來就會出現「AAPL 100 張」這種災難。
 * 這支 helper 把 quantity_unit 交叉 asset_class 做覆寫，asset_class
 * 缺值時再由 expert.asset_class 或 currency=USD 推導 us_stock。
 */
export type LinePushAssetClass =
  | 'tw_stock'
  | 'us_stock'
  | 'us_future'
  | 'us_option'
  | 'crypto'
  | string
  | null
  | undefined;

const ALLOWED: Record<string, readonly string[]> = {
  tw_stock: ['張', '股'],
  us_stock: ['股'],
  us_future: ['口'],
  us_option: ['口'],
  crypto: ['顆', '個'],
};

const DEFAULT_UNIT: Record<string, string> = {
  tw_stock: '張',
  us_stock: '股',
  us_future: '口',
  us_option: '口',
  crypto: '顆',
};

function normalizeAssetClass(a: LinePushAssetClass): string {
  const s = String(a || '').trim().toLowerCase();
  if (s === 'us_stock' || s === 'us_future' || s === 'us_option' || s === 'crypto' || s === 'tw_stock') {
    return s;
  }
  return 'tw_stock';
}

export interface LinePushSignalLike {
  quantity_unit?: string | null;
  asset_class?: string | null;
}

export interface LinePushExpertHint {
  asset_class?: string | null;
  currency?: string | null;
}

/**
 * 決定 LINE 推播該顯示的 quantity 單位。
 * signal.asset_class → expertHint.asset_class → expertHint.currency=USD → tw_stock。
 * 再對照 asset_class 的合法單位白名單，不合法就以該類別預設值覆寫。
 */
export function resolveLinePushQuantityUnit(
  signal: LinePushSignalLike | null | undefined,
  expertHint?: LinePushExpertHint | null,
): string {
  let cls = signal?.asset_class ?? expertHint?.asset_class ?? null;
  if (!cls && expertHint?.currency === 'USD') cls = 'us_stock';
  const norm = normalizeAssetClass(cls);
  const raw = String(signal?.quantity_unit || '').trim();
  const allowed = ALLOWED[norm] || ['張'];
  if (raw && allowed.includes(raw)) return raw;
  return DEFAULT_UNIT[norm] || '張';
}
