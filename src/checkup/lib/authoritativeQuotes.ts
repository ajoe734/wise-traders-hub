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
import { fetchDailyCloseCardsDetailed, type CloseFetchTransport } from './closeAuthority';
import { loadMarketHolidays } from './marketHolidaysLoader';
import { closeAuthorityLane, latestCompletedTradeDate, type CloseAuthorityLane } from './marketCalendar';

export interface AuthoritativeQuote {
  price: number;
  yesterday: number | null;
  change: number;
  changePct: number;
  /** 'close' 才是官方收盤；'snapshot'／'current' 一律 pending（鏡像與盤中報價） */
  source: 'close' | 'snapshot' | 'current';
  updatedAt: string | null;
  /** 只有官方日 K 對齊最後完整交易日才是 confirmed */
  state: 'confirmed' | 'pending';
  /** 事實上落在哪一個交易日（pending 時保留上游 factual 值，不得填 expected） */
  tradeDate: string | null;
  reason: string | null;
}

export interface AuthoritativeQuotesMeta {
  lane: CloseAuthorityLane;
  attempted: boolean;
  transport: CloseFetchTransport | null;
}

export interface AuthoritativeQuotesResult {
  quotes: Record<string, AuthoritativeQuote>;
  meta: AuthoritativeQuotesMeta;
}

export interface AuthoritativeQuotesOptions {
  /** false → 即使在 settled lane 也不呼叫 checkup-sparkline（0 次 Edge） */
  allowAuthority?: boolean;
}

export function isOnline(): boolean {
  try {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  } catch {
    return true;
  }
}

function derive(
  price: number,
  yesterday: number | null,
): { change: number; changePct: number } {
  if (!yesterday || yesterday <= 0) return { change: 0, changePct: 0 };
  return { change: price - yesterday, changePct: ((price - yesterday) / yesterday) * 100 };
}

/**
 * 依市場分組取權威報價。TW 走 close-authority lane：
 *   - settled + allowAuthority → 官方日 K（唯一 confirmed 來源）
 *   - 其餘 lane → 只讀 current_prices，全部 pending，0 次 Edge
 */
export async function fetchAuthoritativeQuotesDetailed(
  codes: string[],
  now: Date = new Date(),
  opts: AuthoritativeQuotesOptions = {},
): Promise<AuthoritativeQuotesResult> {
  const allowAuthority = opts.allowAuthority !== false;
  const symbols = Array.from(
    new Set((codes || []).map((c) => String(c || '').trim()).filter(Boolean)),
  );
  const out: Record<string, AuthoritativeQuote> = {};
  const meta: AuthoritativeQuotesMeta = { lane: 'unknown', attempted: false, transport: null };
  if (!symbols.length) return { quotes: out, meta };

  // request 級載入（loader 每個台北日只打一次 DB）
  await loadMarketHolidays().catch(() => false);
  meta.lane = closeAuthorityLane(now, 'TW');

  const byMarket = new Map<Market, string[]>();
  for (const symbol of symbols) {
    const m = detectHoldingMarket({ symbol });
    if (!byMarket.has(m)) byMarket.set(m, []);
    byMarket.get(m)!.push(symbol);
  }

  await Promise.all(
    Array.from(byMarket.entries()).map(async ([market, list]) => {
      // pending 時要保留的上游 factual 事實（交易日／原因）
      const pendingMeta: Record<string, { tradeDate: string | null; reason: string | null }> = {};

      if (market === 'TW') {
        // 官方日 K：只有 settled lane 且允許 authority 才打（唯一 confirmed 來源）
        if (meta.lane === 'settled' && allowAuthority) {
          const { cards, transport } = await fetchDailyCloseCardsDetailed(list, now);
          meta.attempted = true;
          meta.transport = transport;
          for (const symbol of list) {
            const cc = cards[symbol];
            const price = Number(cc?.close);
            if (cc && cc.state === 'confirmed' && Number.isFinite(price) && price > 0) {
              const yesterday = cc.prevClose != null && cc.prevClose > 0 ? cc.prevClose : null;
              out[symbol] = {
                price,
                yesterday,
                ...derive(price, yesterday),
                source: 'close',
                updatedAt: cc.fetchedAt || cc.tradeDate,
                state: 'confirmed',
                tradeDate: cc.tradeDate,
                reason: null,
              };
            } else {
              pendingMeta[symbol] = { tradeDate: cc?.tradeDate ?? null, reason: cc?.reason ?? null };
            }
          }
        }

        // snapshot 只是 current_prices 的收盤鏡像 → 只能補價，永遠不得標 confirmed。
        // 盤中／結算緩衝不讀（主畫面維持即時），其餘（settled／休市日表未載入）可補。
        if (meta.lane === 'settled' || meta.lane === 'unknown') {
          const needSnapshot = list.filter((s) => !out[s]);
          if (needSnapshot.length) {
            const { data } = await supabase
              .from('daily_price_snapshots')
              .select('symbol, close_price, yesterday_close, trade_date')
              .in('symbol', needSnapshot)
              .eq('trade_date', latestCompletedTradeDate(now, { market: 'TW' }));
            for (const row of (data as any[]) || []) {
              const symbol = String(row.symbol);
              const price = Number(row.close_price);
              if (!Number.isFinite(price) || price <= 0) continue;
              const y = Number(row.yesterday_close);
              const yesterday = Number.isFinite(y) && y > 0 ? y : null;
              out[symbol] = {
                price,
                yesterday,
                ...derive(price, yesterday),
                source: 'snapshot',
                updatedAt: row.trade_date ?? null,
                state: 'pending',
                tradeDate: pendingMeta[symbol]?.tradeDate ?? null,
                reason: pendingMeta[symbol]?.reason ?? 'stale_trade_date',
              };
            }
          }
        }
      } else {
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
            const y = Number(row.yesterday_close);
            const yesterday = Number.isFinite(y) && y > 0 ? y : null;
            out[String(row.symbol)] = {
              price,
              yesterday,
              ...derive(price, yesterday),
              source: 'snapshot',
              updatedAt: row.trade_date ?? null,
              state: 'pending',
              tradeDate: row.trade_date ?? null,
              reason: 'stale_trade_date',
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
        const symbol = String(row.symbol);
        const price = Number(row.price);
        if (!Number.isFinite(price) || price <= 0) continue;
        const y = Number(row.yesterday_close);
        const yesterday = Number.isFinite(y) && y > 0 ? y : null;
        out[symbol] = {
          price,
          yesterday,
          ...derive(price, yesterday),
          source: 'current',
          updatedAt: row.updated_at ?? null,
          state: 'pending',
          tradeDate: pendingMeta[symbol]?.tradeDate ?? null,
          reason: pendingMeta[symbol]?.reason ?? null,
        };
      }
    }),
  );

  // 同步鏡像，讓其他同步消費端立刻看到同一份真相。
  const mirror: Record<string, MirrorQuote> = {};
  for (const [symbol, q] of Object.entries(out)) {
    // mirror 只認 snapshot/current 兩種語意；官方收盤沿用 snapshot 槽位
    const mirrorSource = q.source === 'current' ? 'current' : 'snapshot';
    mirror[symbol] = { price: q.price, source: mirrorSource, updatedAt: q.updatedAt };
  }
  if (Object.keys(mirror).length) writeAuthoritativePrices(mirror as any);

  return { quotes: out, meta };
}

/** 回傳 legacy `marketPriceCache.prices` 相容格式（只要報價、不要 meta）。 */
export async function fetchAuthoritativeQuotes(
  codes: string[],
  now: Date = new Date(),
): Promise<Record<string, AuthoritativeQuote>> {
  return (await fetchAuthoritativeQuotesDetailed(codes, now)).quotes;
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
