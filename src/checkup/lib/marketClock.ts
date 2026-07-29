/**
 * Phase 2 foundation — per-market clock.
 *
 * Determines whether the DB "closing snapshot" is authoritative for a market
 * at a given wall-clock moment. Used by `useAuthoritativePrices` to decide
 * between `daily_price_snapshots` (post-close) and `current_prices` (intraday).
 *
 * All rules are pure and TZ-safe via `Intl.DateTimeFormat`.
 */

export type Market = 'TW' | 'US' | 'CRYPTO' | 'US_OPTION';

export interface MarketPhase {
  /** current-day trading date, YYYY-MM-DD, in the market's local timezone. */
  marketDate: string;
  /** 'closed_pre' | 'open' | 'closed_post' */
  phase: 'closed_pre' | 'open' | 'closed_post';
  /** true when the DB post-close snapshot for today should exist and be trusted. */
  hasSettledSnapshot: boolean;
  /** true for Sat/Sun in the market's local timezone (Crypto ignores). */
  isWeekend: boolean;
}

interface Rule {
  tz: string;
  openMin: number; // minutes since local midnight, inclusive
  closeMin: number; // minutes since local midnight, inclusive
  /** minutes after close before we trust the settled snapshot. */
  settleDelayMin: number;
  weekend: boolean; // skip Sat/Sun?
}

const RULES: Record<Market, Rule> = {
  TW: { tz: 'Asia/Taipei', openMin: 9 * 60, closeMin: 13 * 60 + 30, settleDelayMin: 35, weekend: true },
  US: { tz: 'America/New_York', openMin: 9 * 60 + 30, closeMin: 16 * 60, settleDelayMin: 10, weekend: true },
  US_OPTION: { tz: 'America/New_York', openMin: 9 * 60 + 30, closeMin: 16 * 60, settleDelayMin: 15, weekend: true },
  CRYPTO: { tz: 'UTC', openMin: 0, closeMin: 24 * 60, settleDelayMin: 0, weekend: false },
};

export function marketPhase(market: Market, now: Date = new Date()): MarketPhase {
  const rule = RULES[market];
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: rule.tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const marketDate = `${get('year')}-${get('month')}-${get('day')}`;
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = wdMap[get('weekday')] ?? 0;
  const isWeekend = dow === 0 || dow === 6;

  if (rule.weekend && isWeekend) {
    return { marketDate, phase: 'closed_post', hasSettledSnapshot: false, isWeekend };
  }

  let phase: MarketPhase['phase'];
  if (minutes < rule.openMin) phase = 'closed_pre';
  else if (minutes <= rule.closeMin) phase = 'open';
  else phase = 'closed_post';

  const hasSettledSnapshot =
    phase === 'closed_post' && minutes >= rule.closeMin + rule.settleDelayMin;

  return { marketDate, phase, hasSettledSnapshot, isWeekend };
}

/** Detect market for a given holding row (used by useAuthoritativePrices). */
export function detectHoldingMarket(row: {
  asset_class?: string | null;
  market?: string | null;
  code?: string | null;
  symbol?: string | null;
}): Market {
  const ac = String(row.asset_class || '').toLowerCase();
  if (ac === 'us_option') return 'US_OPTION';
  if (ac === 'crypto') return 'CRYPTO';
  if (ac === 'us_stock') return 'US';
  if (ac === 'tw_stock') return 'TW';
  const m = String(row.market || '').toUpperCase();
  if (m === 'US') return 'US';
  if (m === 'TW') return 'TW';
  const sym = String(row.symbol || row.code || '').trim();
  // Heuristic fallback: 4–6 digit numeric → TW, else US.
  return /^\d{4,6}[A-Z]?$/i.test(sym) ? 'TW' : 'US';
}
