// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { corsHeaders } from '../_shared/cors.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

/**
 * 取「確認收盤價」：
 *   - marketState === 'CLOSED' / 'POSTPOST' / 'PRE'（隔日盤前）→ 用 regularMarketPrice（即當日收盤）
 *   - 盤中（REGULAR）→ 改用 chartCloseSeries[-1]（上一根已收 K），避開跳動的即時價
 *   - 取不到已收 K 時，退回 chartMeta.previousClose（昨收）而不是即時價，避免污染「收盤損益」
 */
async function tryYahoo(yahooSymbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=5d`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    })
    if (!res.ok) return null
    const data = await res.json()
    const result = data.chart?.result?.[0]
    const meta = result?.meta
    if (!meta) return null

    const state: string = meta.marketState || 'UNKNOWN'
    const regular = Number(meta.regularMarketPrice)
    const prevClose = Number(meta.chartPreviousClose ?? meta.previousClose)

    // 已收盤：regularMarketPrice 即為當日收盤
    if (state && state !== 'REGULAR' && Number.isFinite(regular) && regular > 0) {
      return regular
    }

    // 盤中：找最新一根「已收」的日 K 收盤
    const timestamps: number[] = result?.timestamp || []
    const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close || []
    if (timestamps.length && closes.length) {
      // 由後往前找第一根非今日、且 close 有效的
      const todayYMD = new Date().toISOString().slice(0, 10)
      for (let i = closes.length - 1; i >= 0; i--) {
        const c = Number(closes[i])
        const t = timestamps[i]
        if (!Number.isFinite(c) || c <= 0 || !t) continue
        const ymd = new Date(t * 1000).toISOString().slice(0, 10)
        if (ymd !== todayYMD) return c
      }
    }

    if (Number.isFinite(prevClose) && prevClose > 0) return prevClose
    return null
  } catch {
    return null
  }
}


async function fetchClosingPrice(symbol: string): Promise<number | null> {
  // instrument 形如 "2330 台積電" / "NVDA 輝達" / "GOOGL"
  const first = symbol.trim().split(/\s+/)[0] || ''
  if (!first) return null

  // 台股：純數字 → .TW → .TWO
  if (/^\d+$/.test(first)) {
    for (const suffix of ['.TW', '.TWO']) {
      const price = await tryYahoo(`${first}${suffix}`)
      if (price) return price
    }
    return null
  }

  // 美股：字母開頭（允許 BRK.B 這種點號）→ 直接查 Yahoo
  if (/^[A-Za-z][A-Za-z0-9.\-]*$/.test(first)) {
    return await tryYahoo(first.toUpperCase())
  }

  return null
}

Deno.serve(withLogging('daily-performance', async (req) => {
  // AUTH: cron (Phase M-2 runtime enforcement)
  if (req.method !== 'OPTIONS') {
    try { requireCronKey(req); }
    catch (e) {
      if (e instanceof AuthError) {
        return new Response(JSON.stringify({ error: e.message, code: e.code }), {
          status: e.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      throw e;
    }
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = serviceClient()

    // 1. Get all open positions（含 market 以便後續統計 / 觀察）
    const { data: openTrades, error } = await adminClient
      .from('trade_records')
      .select('id, instrument, entry_price, market')
      .eq('status', 'open')

    if (error) throw error
    if (!openTrades || openTrades.length === 0) {
      return new Response(JSON.stringify({ message: 'No open positions', updated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Deduplicate instruments and fetch prices（fetchClosingPrice 內部依 symbol 分派 TW/US）
    const instruments = [...new Set(openTrades.map((t: any) => t.instrument))]
    const priceMap = new Map<string, number>()

    // Fetch prices sequentially to avoid rate limiting
    for (const inst of instruments) {
      const price = await fetchClosingPrice(inst)
      if (price) priceMap.set(inst, price)
    }

    // 3. Update each open trade with current price and unrealized P&L
    let updated = 0
    let updatedTw = 0
    let updatedUs = 0
    const now = new Date().toISOString()

    for (const trade of openTrades as any[]) {
      const currentPrice = priceMap.get(trade.instrument)
      if (!currentPrice) continue

      const pnlPercent = trade.entry_price && trade.entry_price > 0
        ? Math.round(((currentPrice - trade.entry_price) / trade.entry_price) * 10000) / 100
        : null

      const { error: updateError } = await adminClient
        .from('trade_records')
        .update({
          current_price: currentPrice,
          pnl_percent: pnlPercent,
          price_updated_at: now,
        })
        .eq('id', trade.id)

      if (!updateError) {
        updated++
        if (trade.market === 'US') updatedUs++
        else updatedTw++
      }
    }

    // 4. Log the run
    await adminClient.from('system_jobs_log').insert({
      job_name: 'daily_performance_update',
      status: 'success',
      detail: { updated, updated_tw: updatedTw, updated_us: updatedUs, total_open: openTrades.length, prices_fetched: priceMap.size },
    })

    return new Response(JSON.stringify({ success: true, updated, total_open: openTrades.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    console.error('Daily performance error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}))
