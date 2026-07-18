import { resolveDisplayCurrencyWithSource, type Currency, type CurrencySource } from '@/lib/currency';

export interface SignalCurrencyResolutionInput {
  signal_id: string;
  expert_slug: string | null;
  expert_currency: string | null | undefined;
  instrument: string | null | undefined;
  is_preview: boolean;
}

export interface SignalCurrencyResolutionPayload {
  signal_id: string;
  expert_slug: string | null;
  instrument: string | null;
  resolved_currency: Currency;
  source: CurrencySource;
  had_explicit: boolean;
  is_preview: boolean;
}

/**
 * 建構 `signal_currency_resolution` 事件 payload。
 * 抽成純函式方便單元測試與跨頁重用。
 */
export function buildSignalCurrencyResolutionPayload(
  input: SignalCurrencyResolutionInput,
): SignalCurrencyResolutionPayload {
  const { currency, source } = resolveDisplayCurrencyWithSource(
    input.expert_currency,
    input.instrument,
  );
  return {
    signal_id: input.signal_id,
    expert_slug: input.expert_slug ?? null,
    instrument: input.instrument ?? null,
    resolved_currency: currency,
    source,
    had_explicit: input.expert_currency === 'USD' || input.expert_currency === 'TWD',
    is_preview: input.is_preview,
  };
}
