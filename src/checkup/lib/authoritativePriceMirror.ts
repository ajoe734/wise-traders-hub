/**
 * Phase 7 Step 2 — 權威價鏡像（authoritative price mirror）。
 *
 * `useAuthoritativePrices` 是唯一寫入者；所有**同步**的取價消費端
 * （總覽頁、投組摘要、normalizeHoldings、marketStore selector）
 * 透過 `mergeAuthoritativeIntoPriceCache` 讀取，確保全站只有一個價格真相。
 *
 * 鐵則：本鏡像只存 DB 權威來源（snapshot / current / combo）。
 * `offline` / `stale` / `unknown` 一律不寫入，避免污染成第二套快取。
 */
export const AUTHORITATIVE_PRICE_KEY = 'lf.checkup.authoritative-prices.v1';

export interface MirrorQuote {
  price: number;
  source: 'snapshot' | 'current' | 'combo';
  updatedAt: string | null;
}

export type MirrorMap = Record<string, MirrorQuote>;

const AUTHORITATIVE_SOURCES = new Set(['snapshot', 'current', 'combo']);

let __memory: MirrorMap = {};
let __raw: string | null = null;

export function isAuthoritativeSource(source: unknown): boolean {
  return AUTHORITATIVE_SOURCES.has(String(source));
}

export function writeAuthoritativePrices(
  entries: Record<string, { price: number | null; source: string; updatedAt: string | null }>,
): MirrorMap {
  const next: MirrorMap = {};
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
  __memory = next;
  try {
    const serialized = JSON.stringify(next);
    __raw = serialized;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(AUTHORITATIVE_PRICE_KEY, serialized);
    }
  } catch {
    /* storage full / unavailable — memory copy still serves this session */
  }
  return next;
}

export function readAuthoritativePrices(): MirrorMap {
  try {
    if (typeof localStorage === 'undefined') return __memory;
    const raw = localStorage.getItem(AUTHORITATIVE_PRICE_KEY);
    if (raw === __raw) return __memory;
    __raw = raw;
    __memory = raw ? JSON.parse(raw) || {} : {};
  } catch {
    __memory = {};
  }
  return __memory;
}

/** 測試用：清空記憶體與 storage。 */
export function resetAuthoritativePrices(): void {
  __memory = {};
  __raw = null;
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(AUTHORITATIVE_PRICE_KEY);
  } catch {
    /* ignore */
  }
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

  return { ...(cache || {}), prices } as T;
}
