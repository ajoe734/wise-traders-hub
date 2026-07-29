/**
 * Phase 7 Step 3 — DB-first 批次報價（供非 React 同步流程使用）。
 *
 * 與 `useAuthoritativePrices` 共用同一套權威順序（marketClock → snapshot / current），
 * 但以 promise 形式提供給 `useMarketData.getMarketQuotesForCodes`、壓力測試、
 * 事件生命週期、每日分析等 workflow，讓它們不必再直打 TWSE MIS。
 */
import { supabase } from '@/integrations/supabase/client';
import { detectHoldingMarket, marketPhase, type Market } from './marketClock';
import { writeAuthoritativePrices, type MirrorQuote } from './authoritativePriceMirror';

export interface AuthoritativeQuote {
  price: number;
  yesterday: number | null;
  change: number;
  changePct: number;
  source: 'snapshot' | 'current';
  updatedAt: string | null;
}

export function isOnline(): boolean {
  try {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  } catch {
    return true;
  }
}

/**
 * 依市場分組 → settled 讀 daily_price_snapshots，否則讀 current_prices。
 * 回傳 legacy `marketPriceCache.prices` 相容格式，方便就地取代。
 */
export async function fetchAuthoritativeQuotes(
  codes: string[],
  now: Date = new Date(),
): Promise<Record<string, AuthoritativeQuote>> {
  const symbols = Array.from(
    new Set((codes || []).map((c) => String(c || '').trim()).filter(Boolean)),
  );
  const out: Record<string, AuthoritativeQuote> = {};
  if (!symbols.length) return out;

  const byMarket = new Map<Market, string[]>();
  for (const symbol of symbols) {
    const m = detectHoldingMarket({ symbol });
    if (!byMarket.has(m)) byMarket.set(m, []);
    byMarket.get(m)!.push(symbol);
  }

  await Promise.all(
    Array.from(byMarket.entries()).map(async ([market, list]) => {
      const phase = marketPhase(market, now);
      if (phase.hasSettledSnapshot) {
        const { data } = await supabase
          .from('daily_price_snapshots')
          .select('symbol, close_price, yesterday_close, trade_date')
          .in('symbol', list)
          .eq('trade_date', phase.marketDate);
        for (const row of (data as any[]) || []) {
          const price = Number(row.close_price);
          if (!Number.isFinite(price) || price <= 0) continue;
          const yesterday = Number(row.yesterday_close);
          const hasY = Number.isFinite(yesterday) && yesterday > 0;
          out[String(row.symbol)] = {
            price,
            yesterday: hasY ? yesterday : null,
            change: hasY ? price - yesterday : 0,
            changePct: hasY ? ((price - yesterday) / yesterday) * 100 : 0,
            source: 'snapshot',
            updatedAt: row.trade_date ?? null,
          };
        }
      }

      const missing = list.filter((s) => !out[s]);
      if (!missing.length) return;
      const { data } = await supabase
        .from('current_prices')
        .select('symbol, price, yesterday_close, updated_at')
        .in('symbol', missing);
      for (const row of (data as any[]) || []) {
        const price = Number(row.price);
        if (!Number.isFinite(price) || price <= 0) continue;
        const yesterday = Number(row.yesterday_close);
        const hasY = Number.isFinite(yesterday) && yesterday > 0;
        out[String(row.symbol)] = {
          price,
          yesterday: hasY ? yesterday : null,
          change: hasY ? price - yesterday : 0,
          changePct: hasY ? ((price - yesterday) / yesterday) * 100 : 0,
          source: 'current',
          updatedAt: row.updated_at ?? null,
        };
      }
    }),
  );

  // 同步鏡像，讓其他同步消費端立刻看到同一份真相。
  const mirror: Record<string, MirrorQuote> = {};
  for (const [symbol, q] of Object.entries(out)) {
    mirror[symbol] = { price: q.price, source: q.source, updatedAt: q.updatedAt };
  }
  if (Object.keys(mirror).length) writeAuthoritativePrices(mirror as any);

  return out;
}
