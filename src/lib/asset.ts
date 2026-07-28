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
 *
 * 美股衍生性商品採「方案 A：只做部位紀錄」：
 * - 乘數固定 1（不做 options ×100 / futures ×合約表）
 * - 報價 priceSource='manual'：不打行情 API，一律走 holding_meta_overrides.override_price
 */
import type { Currency } from './currency';

export type AssetClass = 'tw_stock' | 'us_stock' | 'crypto' | 'us_option' | 'us_future';
export type QuantityUnit = '張' | '股' | '顆' | '口' | '組';
export type MarketHours = 'tw' | 'us' | 'us_ext' | 'us_future_5x24' | '24x7';
export type PriceSource = 'twse' | 'us' | 'crypto' | 'manual';

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
  /** true 代表沒有自動行情，需使用者手動輸入 override_price */
  requiresManualPrice: boolean;
}

// 美股選擇權 OCC 21 字元格式：Root(1-6) + 6 位到期日 + C/P + 8 位履約價
// 例：AAPL240119C00150000、SPXW240119P04500000
// 允許 Root 與 expiry 之間有可選空白（有些交易所快照會加）
const US_OPTION_RE = /^[A-Z.]{1,6}\s?\d{6}[CP]\d{8}$/;
// 美股期貨：/ + 1-3 大寫 + 可選月碼(FGHJKMNQUVXZ) + 可選 1-2 位年碼
// 例：/ES、/NQ、/CL、/ESZ5、/6EU25
const US_FUTURE_RE = /^\/[A-Z0-9]{1,3}[FGHJKMNQUVXZ]?\d{0,2}$/;

const SPECS: Record<AssetClass, AssetSpec> = {
  tw_stock: {
    assetClass: 'tw_stock',
    label: '台股',
    shortLabel: '台股',
    currency: 'TWD',
    symbolRegex: /^\d{4,6}[A-Z]?$/,
    symbolPlaceholder: '例：2330 / 00631L',
    minSymbolLen: 4,
    uppercaseSymbol: true,
    units: ['張', '股'],
    defaultUnit: '張',
    priceDigits: 2,
    quantityAllowsDecimal: false,
    marketHours: 'tw',
    priceSource: 'twse',
    requiresManualPrice: false,
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
    requiresManualPrice: false,
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
    requiresManualPrice: false,
  },
  us_option: {
    assetClass: 'us_option',
    label: '美股選擇權',
    shortLabel: '選擇權',
    currency: 'USD',
    symbolRegex: US_OPTION_RE,
    symbolPlaceholder: '例：AAPL240119C00150000（OCC 21 字元）',
    minSymbolLen: 15,
    uppercaseSymbol: true,
    units: ['口', '組'],
    defaultUnit: '口',
    priceDigits: 2,
    quantityAllowsDecimal: false,
    marketHours: 'us_ext',
    priceSource: 'manual',
    requiresManualPrice: true,
  },
  us_future: {
    assetClass: 'us_future',
    label: '美股期貨',
    shortLabel: '期貨',
    currency: 'USD',
    symbolRegex: US_FUTURE_RE,
    symbolPlaceholder: '例：/ES / /NQ / /CL',
    minSymbolLen: 2,
    uppercaseSymbol: true,
    units: ['口'],
    defaultUnit: '口',
    priceDigits: 2,
    quantityAllowsDecimal: false,
    marketHours: 'us_future_5x24',
    priceSource: 'manual',
    requiresManualPrice: true,
  },
};

export function normalizeAssetClass(v: unknown): AssetClass {
  if (
    v === 'us_stock' ||
    v === 'crypto' ||
    v === 'tw_stock' ||
    v === 'us_option' ||
    v === 'us_future'
  ) {
    return v;
  }
  // 舊資料 fallback：只有 currency
  if (v === 'USD') return 'us_stock';
  return 'tw_stock';
}

/** 從 expert 物件（可能只有 currency，或已有 asset_class）解析出 AssetClass */
export function resolveAssetClass(
  expert: { asset_class?: string | null; currency?: string | null } | null | undefined,
): AssetClass {
  if (!expert) return 'tw_stock';
  if (expert.asset_class) return normalizeAssetClass(expert.asset_class);
  if (expert.currency === 'USD') return 'us_stock';
  return 'tw_stock';
}

export function getAssetSpec(a: AssetClass | string | null | undefined): AssetSpec {
  return SPECS[normalizeAssetClass(a)];
}

/** 把草稿／舊資料單位校正到資產類別允許清單；僅校正標籤，不換算數量。 */
export function sanitizeAssetQuantityUnit(
  raw: string | null | undefined,
  a: AssetClass | string | null | undefined,
): QuantityUnit {
  const spec = getAssetSpec(a);
  const t = String(raw || '').trim() as QuantityUnit;
  return spec.units.includes(t) ? t : spec.defaultUnit;
}

export function isValidAssetSymbol(
  code: string,
  a: AssetClass | string | null | undefined,
): boolean {
  const spec = getAssetSpec(a);
  const s = (code || '').trim();
  if (!s) return false;
  const normalized = spec.uppercaseSymbol ? s.toUpperCase() : s;
  return spec.symbolRegex.test(normalized);
}

/** 是否為衍生性商品（不接自動行情，全走手動 override） */
export function isDerivativeAssetClass(a: AssetClass | string | null | undefined): boolean {
  const n = normalizeAssetClass(a);
  return n === 'us_option' || n === 'us_future';
}

/** 從 symbol 判斷是否為選擇權 / 期貨代碼（給 edge / marketDetect 用） */
export function detectDerivativeFromSymbol(sym: string | null | undefined): AssetClass | null {
  const s = String(sym || '').trim().toUpperCase();
  if (!s) return null;
  if (US_FUTURE_RE.test(s)) return 'us_future';
  if (US_OPTION_RE.test(s.replace(/\s+/g, ''))) return 'us_option';
  return null;
}

/** 市場是否關閉（週記 / 訊號發布時判斷是否已收盤） */
export function isMarketClosedFor(mode: MarketHours, now: Date = new Date()): boolean {
  if (mode === '24x7') return false;

  if (mode === 'us' || mode === 'us_ext') {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const wd = parts.find((p) => p.type === 'weekday')?.value || '';
    const h = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const m = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
    if (wd === 'Sat' || wd === 'Sun') return true;
    const mins = h * 60 + m;
    if (mode === 'us_ext') {
      // 選擇權：09:30 – 16:15 ET（部分指數選擇權延後 15 分鐘）
      return mins < 9 * 60 + 30 || mins >= 16 * 60 + 15;
    }
    // 現股：09:30 – 16:00 ET
    return mins < 9 * 60 + 30 || mins >= 16 * 60;
  }

  if (mode === 'us_future_5x24') {
    // 期貨：週日 18:00 ET 開盤 – 週五 17:00 ET 收盤
    // 每日 17:00–18:00 ET 為每日結算暫停時段
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const wd = parts.find((p) => p.type === 'weekday')?.value || '';
    const h = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const m = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
    const mins = h * 60 + m;
    if (wd === 'Sat') return true;
    if (wd === 'Sun') return mins < 18 * 60; // 週日 18:00 前關閉
    if (wd === 'Fri') return mins >= 17 * 60; // 週五 17:00 後關閉
    // Mon-Thu：每日 17:00–18:00 為每日結算休息
    return mins >= 17 * 60 && mins < 18 * 60;
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
  const wd = parts.find((p) => p.type === 'weekday')?.value || '';
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
  if (wd === 'Sat' || wd === 'Sun') return true;
  const mins = h * 60 + m;
  return mins < 9 * 60 || mins >= 13 * 60 + 30;
}

export const ALL_ASSET_CLASSES: AssetClass[] = [
  'tw_stock',
  'us_stock',
  'crypto',
  'us_option',
  'us_future',
];
