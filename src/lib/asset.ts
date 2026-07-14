/**
 * 資產類別（asset_class）單一來源
 * 
 * 每位 expert 綁一個 asset_class，決定：
 * - 顯示幣別（TWD / USD）
 * - 代碼驗證規則
 * - 數量單位下拉
 * - 報價來源管線
 * - 市場開盤時區
 * 
 * 舊代碼可繼續使用 @/lib/currency 內的 Currency helper；
 * 新代碼應優先讀 asset_class 並透過 getAssetSpec() 取得規格。
 */
import type { Currency } from './currency';

export type AssetClass = 'tw_stock' | 'us_stock' | 'crypto';
export type QuantityUnit = '張' | '股' | '顆';
export type MarketHours = 'tw' | 'us' | '24x7';
export type PriceSource = 'twse' | 'us' | 'crypto';

export interface AssetSpec {
  assetClass: AssetClass;
  label: string;
  shortLabel: string;
  currency: Currency;
  symbolRegex: RegExp;
  symbolPlaceholder: string;
  /** 自動查名／查價的最小輸入長度 */
  minSymbolLen: number;
  /** 是否要把使用者輸入自動轉大寫 */
  uppercaseSymbol: boolean;
  units: QuantityUnit[];
  defaultUnit: QuantityUnit;
  priceDigits: number;
  /** 數量是否允許小數（僅加密） */
  quantityAllowsDecimal: boolean;
  marketHours: MarketHours;
  priceSource: PriceSource;
}

const SPECS: Record<AssetClass, AssetSpec> = {
  tw_stock: {
    assetClass: 'tw_stock',
    label: '台股',
    shortLabel: '台股',
    currency: 'TWD',
    symbolRegex: /^\d{4,6}$/,
    symbolPlaceholder: '例：2330',
    minSymbolLen: 4,
    uppercaseSymbol: false,
    units: ['張', '股'],
    defaultUnit: '張',
    priceDigits: 2,
    quantityAllowsDecimal: false,
    marketHours: 'tw',
    priceSource: 'twse',
  },
  us_stock: {
    assetClass: 'us_stock',
    label: '美股',
    shortLabel: '美股',
    currency: 'USD',
    symbolRegex: /^[A-Z]{1,5}(\.[A-Z])?$/,
    symbolPlaceholder: '例：AAPL / TSLA',
    minSymbolLen: 1,
    uppercaseSymbol: true,
    units: ['股'],
    defaultUnit: '股',
    priceDigits: 2,
    quantityAllowsDecimal: false,
    marketHours: 'us',
    priceSource: 'us',
  },
  crypto: {
    assetClass: 'crypto',
    label: '加密貨幣',
    shortLabel: '加密',
    currency: 'USD',
    symbolRegex: /^[A-Z0-9]{2,10}$/,
    symbolPlaceholder: '例：BTC / ETH',
    minSymbolLen: 2,
    uppercaseSymbol: true,
    units: ['顆'],
    defaultUnit: '顆',
    priceDigits: 4,
    quantityAllowsDecimal: true,
    marketHours: '24x7',
    priceSource: 'crypto',
  },
};

export function normalizeAssetClass(v: unknown): AssetClass {
  if (v === 'us_stock' || v === 'crypto' || v === 'tw_stock') return v;
  // 舊資料 fallback：只有 currency
  if (v === 'USD') return 'us_stock';
  return 'tw_stock';
}

/** 從 expert 物件（可能只有 currency，或已有 asset_class）解析出 AssetClass */
export function resolveAssetClass(expert: { asset_class?: string | null; currency?: string | null } | null | undefined): AssetClass {
  if (!expert) return 'tw_stock';
  if (expert.asset_class) return normalizeAssetClass(expert.asset_class);
  if (expert.currency === 'USD') return 'us_stock';
  return 'tw_stock';
}

export function getAssetSpec(a: AssetClass | string | null | undefined): AssetSpec {
  return SPECS[normalizeAssetClass(a)];
}

export function isValidAssetSymbol(code: string, a: AssetClass | string | null | undefined): boolean {
  const spec = getAssetSpec(a);
  const s = (code || '').trim();
  if (!s) return false;
  const normalized = spec.uppercaseSymbol ? s.toUpperCase() : s;
  return spec.symbolRegex.test(normalized);
}

/** 市場是否關閉（週記 / 訊號發布時判斷是否已收盤） */
export function isMarketClosedFor(mode: MarketHours, now: Date = new Date()): boolean {
  if (mode === '24x7') return false;
  if (mode === 'us') {
    // 取美東時區當前時間
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const wd = parts.find(p => p.type === 'weekday')?.value || '';
    const h = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const m = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    if (wd === 'Sat' || wd === 'Sun') return true;
    const mins = h * 60 + m;
    // 09:30 – 16:00 為開盤
    return mins < 9 * 60 + 30 || mins >= 16 * 60;
  }
  // tw：台北時間 週一到週五 09:00–13:30
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const wd = parts.find(p => p.type === 'weekday')?.value || '';
  const h = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const m = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  if (wd === 'Sat' || wd === 'Sun') return true;
  const mins = h * 60 + m;
  return mins < 9 * 60 || mins >= 13 * 60 + 30;
}

export const ALL_ASSET_CLASSES: AssetClass[] = ['tw_stock', 'us_stock', 'crypto'];
