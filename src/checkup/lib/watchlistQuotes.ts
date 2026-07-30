/**
 * B1 — watchlist 取價 seam。
 *
 * 契約：任何 watchlist / dossier 的取價都必須經過本檔，
 * 由 `mergeAuthoritativeIntoPriceCache` 把 DB 權威價疊在 legacy
 * `marketPriceCache` 之上，禁止直接讀 `marketPriceCache.prices`。
 */
import { mergeAuthoritativeIntoPriceCache } from './authoritativePriceMirror';

interface LegacyQuote {
  price?: number | null;
  change?: number | null;
  changePct?: number | null;
}

interface PriceCacheLike {
  prices?: Record<string, LegacyQuote> | null;
}

export interface WatchlistRow {
  code?: string | null;
  price?: number | null;
  change?: number | null;
  changePct?: number | null;
  target?: number | null;
  upside?: number | null;
  [key: string]: unknown;
}

/** 把權威價（fallback legacy 快取）套到 watchlist 列上，並重算 upside。 */
export function applyQuotesToWatchlist<T extends WatchlistRow>(
  rows: T[] | null | undefined,
  cache: PriceCacheLike | null | undefined,
): T[] {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return list;

  const merged = mergeAuthoritativeIntoPriceCache(cache as any);
  const prices = merged?.prices;
  if (!prices || Object.keys(prices).length === 0) return list;

  return list.map((item) => {
    const quote = prices[String(item.code ?? '')];
    const newPrice = Number(quote?.price);
    if (!Number.isFinite(newPrice) || newPrice <= 0) return item;

    const target = Number(item.target);
    const hasTarget = Number.isFinite(target) && target > 0;
    return {
      ...item,
      price: newPrice,
      change: quote?.change || 0,
      changePct: quote?.changePct || 0,
      upside: hasTarget ? ((target - newPrice) / newPrice) * 100 : null,
    };
  });
}
