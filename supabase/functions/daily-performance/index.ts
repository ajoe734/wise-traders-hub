import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

async function tryYahoo(yahooSymbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1d`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    })
    if (!res.ok) return null
    const data = await res.json()
    const price = data.chart?.result?.[0]?.meta?.regularMarketPrice
    return price || null
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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = serviceClient()

    // 1. Get all open positions
    const { data: openTrades, error } = await adminClient
      .from('trade_records')
      .select('id, instrument, entry_price')
      .eq('status', 'open')

    if (error) throw error
    if (!openTrades || openTrades.length === 0) {
      return new Response(JSON.stringify({ message: 'No open positions', updated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Deduplicate instruments and fetch prices
    const instruments = [...new Set(openTrades.map(t => t.instrument))]
    const priceMap = new Map<string, number>()

    // Fetch prices sequentially to avoid rate limiting
    for (const inst of instruments) {
      const price = await fetchClosingPrice(inst)
      if (price) priceMap.set(inst, price)
    }

    // 3. Update each open trade with current price and unrealized P&L
    let updated = 0
    const now = new Date().toISOString()

    for (const trade of openTrades) {
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

      if (!updateError) updated++
    }

    // 4. Log the run
    await adminClient.from('system_jobs_log').insert({
      job_name: 'daily_performance_update',
      status: 'success',
      detail: { updated, total_open: openTrades.length, prices_fetched: priceMap.size },
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
