import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function fetchClosingPrice(symbol: string): Promise<number | null> {
  try {
    const code = symbol.match(/^\d+/)?.[0]
    if (!code) return null

    // Try .TW (listed) first, then .TWO (OTC) as fallback
    for (const suffix of ['.TW', '.TWO']) {
      const yahooSymbol = `${code}${suffix}`
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1d`

      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      })

      if (!res.ok) continue

      const data = await res.json()
      const price = data.chart?.result?.[0]?.meta?.regularMarketPrice
      if (price) return price
    }

    return null
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

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
})
