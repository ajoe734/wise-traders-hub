import type { TradeAction } from '@/lib/simulatePositions';
import {
  type Currency,
  formatMoneyByCurrency,
  normalizeCurrency,
} from '@/lib/currency';

export interface OpenPosition {
  symbol: string;
  instrument: string;
  quantity_shares: number;
  entry_price: number;
  current_price: number | null;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pct: number;
}

export interface RecentTrade {
  id: string;
  instrument: string;
  symbol: string;
  status: string;
  quantity_shares: number;
  entry_price: number | null;
  exit_price: number | null;
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
}

export interface TradeDraft {
  uid: string;
  executedAt: string;
  stockCode: string;
  stockName: string;
  action: TradeAction | '';
  priceHint: string;
  quantity: string;
  quantityUnit: '張' | '股';
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

export const emptyTrade = (currency: Currency = 'TWD'): TradeDraft => ({
  uid: newUid(),
  executedAt: nowLocalDatetime(),
  stockCode: '',
  stockName: '',
  action: '',
  priceHint: '',
  quantity: '',
  quantityUnit: currency === 'USD' ? '股' : '張',
  reasonSummary: '',
  reasonDetail: '',
  riskNotes: '',
});

/**
 * 金額格式化。
 * 舊呼叫不帶 currency → 沿用 TWD（`NT$`），向後相容。
 * 新呼叫帶 currency → 自動切到對應符號。
 */
export const fmtMoney = (n: number, currency?: unknown) =>
  formatMoneyByCurrency(n, normalizeCurrency(currency));

export const actionLabels: Record<string, string> = {
  buy: '買進', sell: '賣出', add: '加碼', trim: '減碼', exit: '平損',
};

export type AIField = 'reason_summary' | 'reason_detail' | 'risk_notes' | 'learning_points' | 'overall_summary';
export type AIAssistFn = (
  field: AIField, mode: any, currentHtml: string, instruction: string | undefined, context?: any,
) => Promise<string>;
