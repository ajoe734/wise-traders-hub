/**
 * Stock Name Resolver with batched lookup
 * 
 * Strategy:
 * 1. Check in-memory cache (instant)
 * 2. Check stock_names DB table (< 100ms)
 * 3. Miss → queue into 2s batch window → bulk fetch via Edge Function
 */
import { supabase } from '@/integrations/supabase/client';

// In-memory cache (persists for session)
const memoryCache = new Map<string, string>();

// Pending batch state
let pendingSymbols = new Map<string, {
  resolve: (name: string | null) => void;
  reject: (err: Error) => void;
}[]>();
let batchTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_WINDOW_MS = 2000;

async function flushBatch() {
  batchTimer = null;
  const currentBatch = pendingSymbols;
  pendingSymbols = new Map();

  const symbols = Array.from(currentBatch.keys());
  if (symbols.length === 0) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const res = await fetch(
      `https://${projectId}.supabase.co/functions/v1/stock-name-lookup`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ symbols }),
      }
    );

    if (!res.ok) {
      throw new Error(`stock-name-lookup failed: ${res.status}`);
    }

    const result: Record<string, string> = await res.json();

    // Populate memory cache and resolve promises
    for (const [sym, callbacks] of currentBatch) {
      const name = result[sym] || null;
      if (name) memoryCache.set(sym, name);
      for (const cb of callbacks) cb.resolve(name);
    }
  } catch (err) {
    // Reject all pending
    for (const [, callbacks] of currentBatch) {
      for (const cb of callbacks) cb.reject(err as Error);
    }
  }
}

/**
 * Resolve a stock symbol to its name.
 * Returns immediately from cache if available,
 * otherwise batches with other requests in a 2s window.
 */
export async function resolveStockName(symbol: string): Promise<string | null> {
  const sym = symbol.trim();
  if (!sym) return null;

  // 1. Memory cache (instant)
  const cached = memoryCache.get(sym);
  if (cached) return cached;

  // 2. DB lookup (fast, ~100ms)
  try {
    const { data } = await supabase
      .from('stock_names')
      .select('name')
      .eq('symbol', sym)
      .maybeSingle();

    if (data?.name) {
      memoryCache.set(sym, data.name);
      return data.name;
    }
  } catch {
    // DB query failed, fall through to batch
  }

  // 3. Queue into batch window
  return new Promise<string | null>((resolve, reject) => {
    if (!pendingSymbols.has(sym)) {
      pendingSymbols.set(sym, []);
    }
    pendingSymbols.get(sym)!.push({ resolve, reject });

    // Reset timer on each new addition
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = setTimeout(flushBatch, BATCH_WINDOW_MS);
  });
}

/**
 * Bulk resolve multiple symbols at once.
 * Useful for pre-warming the cache.
 */
export async function resolveStockNames(symbols: string[]): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  const toFetch: string[] = [];

  for (const sym of symbols) {
    const s = sym.trim();
    if (!s) continue;
    const cached = memoryCache.get(s);
    if (cached) {
      results[s] = cached;
    } else {
      toFetch.push(s);
    }
  }

  if (toFetch.length === 0) return results;

  // Check DB in bulk
  const { data: dbRows } = await supabase
    .from('stock_names')
    .select('symbol, name')
    .in('symbol', toFetch);

  const stillMissing: string[] = [];
  for (const sym of toFetch) {
    const found = dbRows?.find(r => r.symbol === sym);
    if (found?.name) {
      memoryCache.set(sym, found.name);
      results[sym] = found.name;
    } else {
      stillMissing.push(sym);
    }
  }

  if (stillMissing.length === 0) return results;

  // Direct batch call for remaining
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const res = await fetch(
      `https://${projectId}.supabase.co/functions/v1/stock-name-lookup`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ symbols: stillMissing }),
      }
    );

    if (res.ok) {
      const fetched: Record<string, string> = await res.json();
      for (const [sym, name] of Object.entries(fetched)) {
        memoryCache.set(sym, name);
        results[sym] = name;
      }
    }
  } catch (e) {
    console.error('Bulk stock name fetch error:', e);
  }

  return results;
}
