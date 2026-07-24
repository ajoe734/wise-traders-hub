import {
  type Currency,
  formatMoneyByCurrency,
  formatPriceByCurrency,
} from '@/lib/currency';
import type { AssetClass } from '@/lib/asset';
import { getAssetSpec } from '@/lib/asset';

export interface PerfRow {
  id: string;
  instrument: string;
  symbol: string;
  name: string | null;
  entry_price: number | null;
  current_price: number | null;
  pnl: number | null;
  pnl_percent: number | null;
  /** UI 顯示用的數量（已由 base_quantity 換算成 quantity_unit 對應的單位；例如 1000 股 → 顯示 1 張）。 */
  quantity: number;
  /** UI 顯示用的單位（張/股/口/顆），已依 asset_class 與零股情況正規化。 */
  quantity_unit: string;
  /** trade_records.quantity 的原始 base 數量（台股恆為股數；期權/期貨為口；crypto 為顆）。 */
  base_quantity?: number | null;
  status: string;
  /** 該持倉的計價幣別（TWD / USD），由 expert.currency 帶入 */
  currency?: Currency;
  /** 資產類別（tw_stock / us_stock / crypto） */
  asset_class?: AssetClass;
}

export interface RealizedRow {
  id: string;
  instrument: string;
  entry_price: number | null;
  exit_price: number | null;
  entry_date: string | null;
  exit_date: string | null;
  pnl_percent: number | null;
  status: string;
  currency?: Currency;
  asset_class?: AssetClass;
}


export interface CapitalStatus {
  starting_capital: number;
  available_cash: number;
  open_cost_value: number;
  realized_pnl_amount: number;
}

export type RealizedPeriod = 'week' | 'month' | 'year';

export const periodLabel: Record<RealizedPeriod, string> = {
  week: '近一週',
  month: '近一月',
  year: '近一年',
};

export const pnlColor = (val: number | null) =>
  val != null && val > 0
    ? 'text-red-600 dark:text-red-400'
    : val != null && val < 0
      ? 'text-green-600 dark:text-green-400'
      : 'text-foreground';

/** 帶幣別的金額顯示：如 "+NT$1,234" / "-US$56"。 */
export const fmtPnl = (v: number, c: Currency = 'TWD') => {
  const sign = v > 0 ? '+' : '';
  return `${sign}${formatMoneyByCurrency(v, c)}`;
};
export const fmtPrice = (v: number | null, c: Currency = 'TWD', assetClass?: AssetClass) => {
  if (v == null) return '-';
  if (assetClass) {
    const spec = getAssetSpec(assetClass);
    return formatPriceByCurrency(v, spec.currency, spec.priceDigits);
  }
  return formatPriceByCurrency(v, c);
};
export const fmtMoney = (v: number, c: Currency = 'TWD') => formatMoneyByCurrency(v, c);
export const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
export const fmtDate = (d: string | null) => {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' });
};

/** 資產類別 → 徽章顯示樣式 */
export const assetBadge = (a?: AssetClass) => {
  if (!a) return null;
  const spec = getAssetSpec(a);
  const cls =
    a === 'us_stock' ? 'border-blue-400/40 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
    : a === 'crypto' ? 'border-amber-400/40 bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
    : 'border-border bg-muted text-muted-foreground';
  return { label: spec.shortLabel, className: cls };
};


// instrument 格式: "2330 台積電"
export const parseInstrument = (inst: string) => {
  const parts = inst.split(' ');
  const symbol = parts[0] || inst;
  const name = parts.slice(1).join(' ') || null;
  return { symbol, name };
};
