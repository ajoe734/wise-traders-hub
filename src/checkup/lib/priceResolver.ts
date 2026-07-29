/**
 * Phase 7 — 單一取價 resolver（唯一權威入口）。
 *
 * 契約（docs/architecture/price-authority.md）：
 *   snapshot > current > combo > offline(僅離線) > stale/unknown
 *
 * 鐵則：`online === true` 時**永遠不得**回傳 LocalStorage（offline cache）價格。
 * 任何新的取價路徑都必須呼叫本檔，不得直接讀 `marketPriceCache.prices`。
 */
import type { Market } from './marketClock';

export type PriceSource =
  | 'snapshot'
  | 'current'
  | 'combo'
  | 'offline'
  | 'stale'
  | 'unknown';

export type StaleReason =
  | 'db_miss'
  | 'combo_leg_missing'
  | 'combo_no_legs'
  | 'offline_no_cache'
  | null;

export interface ResolvedPrice {
  price: number | null;
  source: PriceSource;
  updatedAt: string | null;
  market: Market;
  reason: StaleReason;
}

export interface ResolveInput {
  market: Market;
  /** DB hit（snapshot 或 current），已由呼叫端決定 source。 */
  authoritative?: { price: number; updatedAt: string | null; source: 'snapshot' | 'current' } | null;
  /** Combo 聚合結果；`price` 為 null 代表有腿缺價。 */
  combo?: { price: number | null; legCount: number } | null;
  /** LocalStorage 快取（僅離線可用）。 */
  offline?: { price?: number; syncedAt?: string } | null;
  online: boolean;
}

export function resolvePrice(input: ResolveInput): ResolvedPrice {
  const { market, authoritative, combo, offline, online } = input;

  // 1. Combo 專用路徑（呼叫端判定 is_combo 時才傳）
  if (combo) {
    if (combo.legCount > 0 && Number.isFinite(combo.price as number)) {
      return {
        price: combo.price as number,
        source: 'combo',
        updatedAt: null,
        market,
        reason: null,
      };
    }
    return {
      price: null,
      source: 'stale',
      updatedAt: null,
      market,
      reason: combo.legCount > 0 ? 'combo_leg_missing' : 'combo_no_legs',
    };
  }

  // 2. DB 權威值（snapshot 優先，由呼叫端保證）
  if (authoritative && Number.isFinite(authoritative.price) && authoritative.price > 0) {
    return {
      price: authoritative.price,
      source: authoritative.source,
      updatedAt: authoritative.updatedAt,
      market,
      reason: null,
    };
  }

  // 3. 離線 fallback —— 僅在 online === false 時允許
  if (!online) {
    const p = Number(offline?.price);
    if (Number.isFinite(p) && p > 0) {
      return {
        price: p,
        source: 'offline',
        updatedAt: offline?.syncedAt ?? null,
        market,
        reason: null,
      };
    }
    return { price: null, source: 'unknown', updatedAt: null, market, reason: 'offline_no_cache' };
  }

  return { price: null, source: 'stale', updatedAt: null, market, reason: 'db_miss' };
}
