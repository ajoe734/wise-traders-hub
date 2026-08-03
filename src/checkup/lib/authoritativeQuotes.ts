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
import { fetchConfirmedCloses } from './closeAuthority';

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
        // 0. 官方日 K 優先（唯一「收盤」事實）。`daily_price_snapshots` 只是
        //    current_prices 的 14:00 鏡像，冷門股會把舊 quote 寫成當日收盤，
        //    所以它只能當官方日 K 的 fallback，不能當權威。
        if (market === 'TW') {
          try {
            const cards = await fetchConfirmedCloses(list, now);
            for (const [symbol, cc] of Object.entries(cards)) {
              const price = Number(cc.close);
              if (!Number.isFinite(price) || price <= 0) continue;
              const yesterday = cc.prevClose != null && cc.prevClose > 0 ? cc.prevClose : null;
              out[symbol] = {
                price,
                yesterday,
                change: yesterday ? price - yesterday : 0,
                changePct: yesterday ? ((price - yesterday) / yesterday) * 100 : 0,
                source: 'snapshot',
                updatedAt: cc.tradeDate,
              };
            }
          } catch { /* 官方日 K 失敗 → 落到既有 snapshot / current 路徑 */ }
        }

        const needSnapshot = list.filter((s) => !out[s]);
        if (needSnapshot.length) {
          const { data } = await supabase
            .from('daily_price_snapshots')
            .select('symbol, close_price, yesterday_close, trade_date')
            .in('symbol', needSnapshot)
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

/** 單一代號版本；找不到權威價時回傳 null（呼叫端不得改讀 legacy 快取）。 */
export async function fetchAuthoritativeQuote(
  symbol: string,
  now: Date = new Date(),
): Promise<AuthoritativeQuote | null> {
  const code = String(symbol || '').trim();
  if (!code) return null;
  const out = await fetchAuthoritativeQuotes([code], now);
  return out[code] ?? null;
}
