/**
 * Phase 7 Step 2 — 權威價鏡像（authoritative price mirror）。
 *
 * `useAuthoritativePrices` 是唯一寫入者；所有**同步**的取價消費端
 * （總覽頁、投組摘要、normalizeHoldings、marketStore selector）
 * 透過 `mergeAuthoritativeIntoPriceCache` 讀取，確保全站只有一個價格真相。
 *
 * 鐵則：本鏡像只存 DB 權威來源（snapshot / current / combo）。
 * `offline` / `stale` / `unknown` 一律不寫入，避免污染成第二套快取。
 *
 * 持久化（候選 B）：記憶體 + localStorage 兩層一律交給
 * `checkupCacheStore` 的 document cache，本檔不再自行 try/catch storage。
 * storage key 與 JSON 格式維持不變，舊資料可直接沿用。
 */
import { createDocumentCache } from './checkupCacheStore';

export const AUTHORITATIVE_PRICE_KEY = 'lf.checkup.authoritative-prices.v1';

export interface MirrorQuote {
  price: number;
  source: 'snapshot' | 'current' | 'combo';
  updatedAt: string | null;
}

export type MirrorMap = Record<string, MirrorQuote>;

const AUTHORITATIVE_SOURCES = new Set(['snapshot', 'current', 'combo']);

const doc = createDocumentCache<MirrorMap>({
  storageKey: AUTHORITATIVE_PRICE_KEY,
  empty: () => ({}),
});

export function isAuthoritativeSource(source: unknown): boolean {
  return AUTHORITATIVE_SOURCES.has(String(source));
}

export function writeAuthoritativePrices(
  entries: Record<string, { price: number | null; source: string; updatedAt: string | null }>,
): MirrorMap {
  // Upsert 語意：部分寫入者（fetchAuthoritativeQuotes）不得清掉其他 symbol。
  const next: MirrorMap = { ...readAuthoritativePrices() };
  for (const [symbol, entry] of Object.entries(entries || {})) {
    const price = Number(entry?.price);
    if (!isAuthoritativeSource(entry?.source)) continue;
    if (!Number.isFinite(price) || price === 0) continue;
    next[symbol] = {
      price,
      source: entry.source as MirrorQuote['source'],
      updatedAt: entry.updatedAt ?? null,
    };
  }
  return doc.write(next);
}

export function readAuthoritativePrices(): MirrorMap {
  return doc.read();
}

/** 測試用：清空記憶體與 storage。 */
export function resetAuthoritativePrices(): void {
  doc.reset();
}


/**
 * 將權威價覆蓋在 legacy `marketPriceCache` 之上。
 * 保留 legacy 的 `yesterday`，以便 change/changePct 依權威價重算。
 */
export function mergeAuthoritativeIntoPriceCache<
  T extends { prices?: Record<string, any> | null } | null | undefined,
>(cache: T, mirror: MirrorMap = readAuthoritativePrices()): T {
  const symbols = Object.keys(mirror || {});
  if (!symbols.length) return cache;

  const base: any = cache || {
    marketDate: null,
    syncedAt: null,
    source: 'authoritative',
    status: 'fresh',
    prices: {},
  };
  const basePrices = base.prices || {};

  const prices: Record<string, any> = { ...basePrices };
  for (const symbol of symbols) {
    const quote = mirror[symbol];
    const price = Number(quote?.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const prev = basePrices[symbol] || {};
    const yesterday = Number(prev.yesterday);
    const hasYesterday = Number.isFinite(yesterday) && yesterday > 0;
    prices[symbol] = {
      ...prev,
      price,
      yesterday: hasYesterday ? yesterday : null,
      change: hasYesterday ? price - yesterday : 0,
      changePct: hasYesterday ? ((price - yesterday) / yesterday) * 100 : 0,
      source: quote.source,
      updatedAt: quote.updatedAt ?? null,
    };
  }

  return { ...base, prices } as T;
}
