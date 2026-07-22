import {
  getAssetSpec,
  sanitizeAssetQuantityUnit,
  type AssetClass,
  type QuantityUnit,
} from '@/lib/asset';

export interface PositionQuantityDisplay {
  /** Actual base quantity stored in trade_records.quantity. 台股 = 股數；美股 = 股；期權/期貨 = 口；crypto = 顆。 */
  baseQuantity: number;
  /** Unit safe to show/import in the editor. */
  unit: QuantityUnit;
  /** Quantity in `unit`, suitable for the trade draft quantity input. */
  inputQuantity: number;
  /** Human-readable label, e.g. `1 張`, `1,000 股`, `2 口`. */
  label: string;
}

function cleanBaseQuantity(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function formatNumber(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString()
    : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** Convert a draft quantity + unit into the base quantity used by cost/market-value math. */
export function normalizeQuantityToBaseUnits(
  quantity: number | null | undefined,
  quantityUnit: string | null | undefined,
): number {
  const q = Number(quantity ?? 0);
  if (!Number.isFinite(q) || q <= 0) return 1;
  return quantityUnit === '張' ? Math.floor(q) * 1000 : Math.floor(q);
}

/**
 * Convert stored base quantity back into a UI quantity.
 *
 * Important: if a TW position says `張` but the base quantity cannot be represented
 * as an integer lot, fall back to `股` to avoid writing fractional lots into an
 * integer quantity field.
 */
export function resolvePositionQuantityDisplay(
  baseQuantity: unknown,
  quantityUnit: string | null | undefined,
  assetClass: AssetClass | string | null | undefined = 'tw_stock',
): PositionQuantityDisplay {
  const base = cleanBaseQuantity(baseQuantity);
  const spec = getAssetSpec(assetClass);
  const safeUnit = sanitizeAssetQuantityUnit(quantityUnit, assetClass);

  if (safeUnit === '張') {
    if (base > 0 && base % 1000 === 0) {
      const lots = base / 1000;
      return {
        baseQuantity: base,
        unit: '張',
        inputQuantity: lots,
        label: `${formatNumber(lots)} 張`,
      };
    }
    const fallbackUnit: QuantityUnit = spec.units.includes('股') ? '股' : safeUnit;
    return {
      baseQuantity: base,
      unit: fallbackUnit,
      inputQuantity: base,
      label: `${formatNumber(base)} ${fallbackUnit}`,
    };
  }

  return {
    baseQuantity: base,
    unit: safeUnit,
    inputQuantity: base,
    label: `${formatNumber(base)} ${safeUnit}`,
  };
}

export function formatBaseQuantity(
  baseQuantity: unknown,
  quantityUnit: string | null | undefined,
  assetClass: AssetClass | string | null | undefined = 'tw_stock',
): string {
  return resolvePositionQuantityDisplay(baseQuantity, quantityUnit, assetClass).label;
}

/** Return the largest integer quantity that can be placed in a draft input. */
export function resolveMaxBuyDraftQuantity(
  maxBaseQuantity: unknown,
  preferredUnit: string | null | undefined,
  assetClass: AssetClass | string | null | undefined = 'tw_stock',
): { quantity: string; quantityUnit: QuantityUnit } {
  const base = cleanBaseQuantity(maxBaseQuantity);
  const spec = getAssetSpec(assetClass);
  const unit = sanitizeAssetQuantityUnit(preferredUnit, assetClass);

  if (unit === '張') {
    const lots = Math.floor(base / 1000);
    if (lots > 0) return { quantity: String(lots), quantityUnit: '張' };
    if (spec.units.includes('股')) return { quantity: String(base), quantityUnit: '股' };
  }
  return { quantity: String(base), quantityUnit: unit };
}

/**
 * C9：對應「全部賣出／減碼上限」按鈕。
 *
 * 與 `resolveMaxBuyDraftQuantity` 對稱，但更嚴格：
 *   - 台股「張」若持倉非 1000 倍數（例如零股 800），一律 fallback 到「股」單位，
 *     避免使用者被 UI 誘導填 0 張後 trigger 賣不出而報 OVERSELL。
 *   - 美股/期權/crypto 直接回傳 base 數 + 該資產預設單位。
 */
export function resolveMaxSellDraftQuantity(
  availableBaseQuantity: unknown,
  preferredUnit: string | null | undefined,
  assetClass: AssetClass | string | null | undefined = 'tw_stock',
): { quantity: string; quantityUnit: QuantityUnit } {
  const base = cleanBaseQuantity(availableBaseQuantity);
  const spec = getAssetSpec(assetClass);
  const unit = sanitizeAssetQuantityUnit(preferredUnit, assetClass);

  if (base <= 0) return { quantity: '0', quantityUnit: unit };

  if (unit === '張') {
    if (base % 1000 === 0) {
      return { quantity: String(base / 1000), quantityUnit: '張' };
    }
    // 零股殘量：改用「股」，數量 = base
    if (spec.units.includes('股')) return { quantity: String(base), quantityUnit: '股' };
  }
  return { quantity: String(base), quantityUnit: unit };
}