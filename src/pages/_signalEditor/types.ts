import type { TradeAction } from '@/lib/simulatePositions';
import {
  type Currency,
  formatMoneyByCurrency,
  normalizeCurrency,
} from '@/lib/currency';
import { getAssetSpec, normalizeAssetClass, type AssetClass, type QuantityUnit } from '@/lib/asset';

export interface OpenPosition {
  id?: string;
  symbol: string;
  instrument: string;
  /** Base quantity stored in trade_records.quantity. 台股 = 股數；期權/期貨 = 口。 */
  quantity_shares: number;
  quantity_unit?: QuantityUnit | string | null;
  market?: string | null;
  currency?: Currency | string | null;
  asset_class?: AssetClass | string | null;
  entry_price: number;
  entry_date?: string | null;
  current_price: number | null;
  market_value: number;
  cost_value?: number;
  unrealized_pnl: number;
  unrealized_pct: number;
}

export interface RecentTrade {
  id: string;
  instrument: string;
  symbol: string;
  status: string;
  quantity_shares: number;
  quantity_unit?: QuantityUnit | string | null;
  market?: string | null;
  currency?: Currency | string | null;
  asset_class?: AssetClass | string | null;
  entry_price: number | null;
  entry_date?: string | null;
  exit_price: number | null;
  exit_date?: string | null;
  pnl_percent: number | null;
  created_at: string;
}

export interface CapitalStatus {
  starting_capital: number;
  realized_pnl_amount: number;
  open_cost_value: number;
  open_market_value: number;
  unrealized_pnl_amount: number;
  available_cash: number;
  open_positions: OpenPosition[];
  recent_trades: RecentTrade[];
  /** 從 expert.currency 帶下來，預設 TWD */
  currency?: Currency;
  /** 從 expert.asset_class 帶下來，預設 tw_stock */
  asset_class?: AssetClass | string | null;
}

export interface TradeDraft {
  uid: string;
  executedAt: string;
  stockCode: string;
  stockName: string;
  action: TradeAction | '';
  priceHint: string;
  quantity: string;
  quantityUnit: QuantityUnit;
  reasonSummary: string;
  reasonDetail: string;
  riskNotes: string;
}

export const newUid = () => Math.random().toString(36).slice(2, 10);

export const nowLocalDatetime = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const emptyTrade = (assetOrCurrency: Currency | AssetClass = 'TWD'): TradeDraft => {
  const assetClass: AssetClass = assetOrCurrency === 'USD'
    ? 'us_stock'
    : assetOrCurrency === 'TWD'
      ? 'tw_stock'
      : normalizeAssetClass(assetOrCurrency);
  const spec = getAssetSpec(assetClass);
  return {
  uid: newUid(),
  executedAt: nowLocalDatetime(),
  stockCode: '',
  stockName: '',
  action: '',
  priceHint: '',
  quantity: '',
  quantityUnit: spec.defaultUnit,
  reasonSummary: '',
  reasonDetail: '',
  riskNotes: '',
  };
};

/**
 * 金額格式化。
 * 舊呼叫不帶 currency → 沿用 TWD（`NT$`），向後相容。
 * 新呼叫帶 currency → 自動切到對應符號。
 */
export const fmtMoney = (n: number, currency?: unknown) =>
  formatMoneyByCurrency(n, normalizeCurrency(currency));


export type AIField = 'reason_summary' | 'reason_detail' | 'risk_notes' | 'learning_points' | 'overall_summary';
export type AIAssistFn = (
  field: AIField, mode: any, currentHtml: string, instruction: string | undefined, context?: any,
) => Promise<string>;
