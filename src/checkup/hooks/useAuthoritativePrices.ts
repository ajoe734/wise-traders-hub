/**
 * Phase 2b — DB-first authoritative price hook.
 *
 * Order of authority (see docs/architecture/price-authority.md):
 *   1. marketPhase(market, now) → hasSettledSnapshot?
 *        yes → daily_price_snapshots (symbol=any, market_date=today-in-tz)
 *        no  → current_prices (symbol=any) + Realtime subscribe
 *   2. Combo rows (is_combo=true) → read expert_signal_legs, price each leg from
 *        current_prices, aggregate via optionCombo.calcNetPremium.
 *   3. DB miss:
 *        online  → mark `stale`
 *        offline → LocalStorage fallback via `market.getCachedQuotesForCodes`
 *
 * Returns a map keyed by row.symbol (fallback row.code) with:
 *   { price, source, updatedAt }
 *
 * Realtime subscription is a single channel per hook instance, torn down on
 * unmount to avoid leaks (see <cloud-realtime> in workspace instructions).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { calcNetPremium, buildOccSymbol, type ComboLeg } from '@/lib/optionCombo';
import { detectHoldingMarket, marketPhase, type Market } from '../lib/marketClock';
import {
  getCachedQuotesForCodes,
  normalizeMarketPriceCache,
} from '../lib/market.js';
import { readStorageValue } from '../lib/portfolioUtils.js';
import { MARKET_PRICE_CACHE_KEY } from '../constants.js';

export type PriceSource =
  | 'snapshot'   // daily_price_snapshots (post-close authoritative)
  | 'current'    // current_prices (intraday)
  | 'combo'      // aggregated from expert_signal_legs
  | 'offline'    // LocalStorage fallback while navigator.offline
  | 'stale'      // DB miss while online — value unknown/last-known
  | 'unknown';   // nothing available

export interface AuthoritativePrice {
  price: number | null;
  source: PriceSource;
  updatedAt: string | null;
  market: Market;
}

export interface HoldingRowInput {
  symbol?: string | null;
  code?: string | null;
  asset_class?: string | null;
  market?: string | null;
  is_combo?: boolean | null;
  signal_id?: string | null;
  id?: string | null;
}

type Result = Record<string, AuthoritativePrice>;

const rowKey = (r: HoldingRowInput): string => String(r.symbol || r.code || '').trim();

const isOnline = (): boolean => {
  try {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  } catch {
    return true;
  }
};

async function fetchSnapshotPrices(
  symbols: string[],
  marketDate: string,
): Promise<Map<string, { price: number; updatedAt: string | null }>> {
  const out = new Map<string, { price: number; updatedAt: string | null }>();
  if (!symbols.length) return out;
  const { data, error } = await supabase
    .from('daily_price_snapshots')
    .select('symbol, close_price, trade_date')
    .in('symbol', symbols)
    .eq('trade_date', marketDate);
  if (error || !data) return out;
  for (const row of data as any[]) {
    const price = Number(row.close_price);
    if (Number.isFinite(price) && price > 0) {
      out.set(String(row.symbol), { price, updatedAt: String(row.trade_date) });
    }
  }
  return out;
}

async function fetchCurrentPrices(
  symbols: string[],
): Promise<Map<string, { price: number; updatedAt: string | null }>> {
  const out = new Map<string, { price: number; updatedAt: string | null }>();
  if (!symbols.length) return out;
  const { data, error } = await supabase
    .from('current_prices')
    .select('symbol, price, updated_at')
    .in('symbol', symbols);
  if (error || !data) return out;
  for (const row of data as any[]) {
    const price = Number(row.price);
    if (Number.isFinite(price) && price > 0) {
      out.set(String(row.symbol), { price, updatedAt: row.updated_at ?? null });
    }
  }
  return out;
}

async function fetchComboLegs(signalIds: string[]): Promise<Map<string, ComboLeg[]>> {
  const grouped = new Map<string, ComboLeg[]>();
  if (!signalIds.length) return grouped;
  const { data, error } = await supabase
    .from('expert_signal_legs')
    .select('signal_id, underlying, expiry, right, strike, side, ratio, price')
    .in('signal_id', signalIds);
  if (error || !data) return grouped;
  for (const row of data as any[]) {
    const leg: ComboLeg = {
      underlying: String(row.underlying || ''),
      expiry: String(row.expiry || ''),
      right: (row.right === 'P' ? 'P' : 'C'),
      strike: Number(row.strike || 0),
      side: row.side === 'short' ? 'short' : 'long',
      ratio: Math.max(1, Number(row.ratio || 1)),
      price: Number(row.price || 0),
    };
    const key = String(row.signal_id);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(leg);
  }
  return grouped;
}

/** Rebuild per-row prices from the fetched maps + offline fallback. */
export function combineAuthoritativePrices(params: {
  rows: HoldingRowInput[];
  bySymbol: Map<string, { price: number; updatedAt: string | null; source: PriceSource; market: Market }>;
  comboLegs: Map<string, ComboLeg[]>;
  legPrices: Map<string, number>; // OCC → mark
  offlineCache: Record<string, { price?: number; syncedAt?: string } | undefined>;
  online: boolean;
}): Result {
  const { rows, bySymbol, comboLegs, legPrices, offlineCache, online } = params;
  const result: Result = {};

  for (const row of rows) {
    const key = rowKey(row);
    if (!key) continue;
    const market = detectHoldingMarket(row);

    // Combo path
    if (row.is_combo && row.signal_id) {
      const legs = comboLegs.get(String(row.signal_id)) || [];
      const priced = legs.map((l) => ({ ...l, price: legPrices.get(buildOccSymbol(l)) ?? NaN }));
      const anyMissing = priced.some((l) => !Number.isFinite(l.price));
      if (!anyMissing && priced.length > 0) {
        result[key] = {
          price: calcNetPremium(priced),
          source: 'combo',
          updatedAt: null,
          market,
        };
      } else {
        result[key] = { price: null, source: 'stale', updatedAt: null, market };
      }
      continue;
    }

    const hit = bySymbol.get(key);
    if (hit) {
      result[key] = { price: hit.price, source: hit.source, updatedAt: hit.updatedAt, market };
      continue;
    }

    // Offline fallback
    if (!online) {
      const cached = offlineCache[key];
      const p = Number(cached?.price);
      if (Number.isFinite(p) && p > 0) {
        result[key] = { price: p, source: 'offline', updatedAt: cached?.syncedAt ?? null, market };
        continue;
      }
    }

    result[key] = {
      price: null,
      source: online ? 'stale' : 'unknown',
      updatedAt: null,
      market,
    };
  }

  return result;
}

export interface UseAuthoritativePricesOptions {
  /** For tests / SSR — override Date.now. */
  now?: Date;
  /** Disable realtime (tests). */
  realtime?: boolean;
}

export function useAuthoritativePrices(
  rows: HoldingRowInput[],
  opts: UseAuthoritativePricesOptions = {},
): { prices: Result; loading: boolean } {
  const { now, realtime = true } = opts;
  const [prices, setPrices] = useState<Result>({});
  const [loading, setLoading] = useState(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Stable fingerprint of the rows we care about (avoid infinite re-fetch loops).
  const fingerprint = useMemo(() => {
    return rows
      .map((r) => `${rowKey(r)}|${detectHoldingMarket(r)}|${r.is_combo ? '1' : '0'}|${r.signal_id || ''}`)
      .sort()
      .join(',');
  }, [rows]);

  useEffect(() => {
    let cancelled = false;
    const online = isOnline();

    async function run() {
      setLoading(true);
      const currentRows = rowsRef.current;

      // Group rows by market to decide snapshot vs current.
      const byMarket = new Map<Market, HoldingRowInput[]>();
      const comboRows: HoldingRowInput[] = [];
      for (const r of currentRows) {
        if (r.is_combo && r.signal_id) {
          comboRows.push(r);
          continue;
        }
        const m = detectHoldingMarket(r);
        if (!byMarket.has(m)) byMarket.set(m, []);
        byMarket.get(m)!.push(r);
      }

      const bySymbol = new Map<
        string,
        { price: number; updatedAt: string | null; source: PriceSource; market: Market }
      >();

      const tasks: Promise<void>[] = [];
      for (const [m, list] of byMarket) {
        const phase = marketPhase(m, now || new Date());
        const symbols = Array.from(new Set(list.map(rowKey).filter(Boolean)));
        if (!symbols.length) continue;
        if (phase.hasSettledSnapshot) {
          tasks.push(
            fetchSnapshotPrices(symbols, phase.marketDate).then((map) => {
              for (const [s, v] of map) bySymbol.set(s, { ...v, source: 'snapshot', market: m });
            }),
          );
        }
        // Always chase current_prices too as fallback for snapshot-miss symbols.
        tasks.push(
          fetchCurrentPrices(symbols).then((map) => {
            for (const [s, v] of map) {
              if (!bySymbol.has(s)) bySymbol.set(s, { ...v, source: 'current', market: m });
            }
          }),
        );
      }

      // Combo legs → OCC symbols → current_prices
      const legMap = comboRows.length
        ? await fetchComboLegs(Array.from(new Set(comboRows.map((r) => String(r.signal_id)))))
        : new Map<string, ComboLeg[]>();
      const occSet = new Set<string>();
      for (const legs of legMap.values()) {
        for (const l of legs) {
          const occ = buildOccSymbol(l);
          if (occ) occSet.add(occ);
        }
      }
      const legPricesMap = new Map<string, number>();
      if (occSet.size) {
        tasks.push(
          fetchCurrentPrices(Array.from(occSet)).then((map) => {
            for (const [s, v] of map) legPricesMap.set(s, v.price);
          }),
        );
      }

      await Promise.all(tasks);
      if (cancelled) return;

      const offlineCache = normalizeMarketPriceCache(readStorageValue(MARKET_PRICE_CACHE_KEY))?.prices || {};
      const next = combineAuthoritativePrices({
        rows: currentRows,
        bySymbol,
        comboLegs: legMap,
        legPrices: legPricesMap,
        offlineCache,
        online,
      });
      setPrices(next);
      setLoading(false);
    }

    run().catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);

  // Single Realtime channel keyed on the fingerprint. Torn down on unmount.
  useEffect(() => {
    if (!realtime) return;
    const symbols = Array.from(new Set(rowsRef.current.map(rowKey).filter(Boolean)));
    if (!symbols.length) return;
    const channel = supabase
      .channel(`authoritative-prices-${symbols.slice(0, 3).join('-')}-${symbols.length}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'current_prices' },
        (payload) => {
          const row = payload.new as any;
          const sym = String(row?.symbol || '');
          if (!sym || !symbols.includes(sym)) return;
          const price = Number(row.price);
          if (!Number.isFinite(price) || price <= 0) return;
          setPrices((prev) => {
            const existing = prev[sym];
            if (!existing || existing.source === 'snapshot') return prev; // snapshot wins
            return {
              ...prev,
              [sym]: {
                ...existing,
                price,
                source: 'current',
                updatedAt: row.updated_at ?? null,
              },
            };
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fingerprint, realtime]);

  return { prices, loading };
}
