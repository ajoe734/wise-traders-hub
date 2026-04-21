import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Use Taipei timezone for trade_date
    const now = new Date()
    const taipeiDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }))
    const tradeDate = taipeiDate.toISOString().split('T')[0] // YYYY-MM-DD

    // Step 1: Read all current_prices and snapshot them
    const { data: prices, error: pricesErr } = await supabase
      .from('current_prices')
      .select('symbol, price, yesterday_close, change_percent, limit_up, volume')

    if (pricesErr) throw pricesErr
    if (!prices || prices.length === 0) {
      return new Response(JSON.stringify({ message: 'No prices to snapshot', date: tradeDate }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Build snapshot rows; determine is_limit_up by comparing close >= limit_up
    const snapshotRows = prices
      .filter(p => p.price && p.price > 0)
      .map(p => {
        const isLimitUp = p.limit_up != null && p.price != null && p.price >= p.limit_up
        return {
          symbol: p.symbol,
          trade_date: tradeDate,
          close_price: p.price,
          yesterday_close: p.yesterday_close,
          change_percent: p.change_percent,
          is_limit_up: isLimitUp,
          limit_up_price: p.limit_up,
          volume: p.volume,
        }
      })

    if (snapshotRows.length > 0) {
      const { error: snapErr } = await supabase
        .from('daily_price_snapshots')
        .upsert(snapshotRows, { onConflict: 'symbol,trade_date' })
      if (snapErr) console.error('snapshot upsert error:', snapErr)
    }

    // Step 2: Find limit-up symbols today
    const limitUpSymbols = snapshotRows.filter(r => r.is_limit_up).map(r => r.symbol)

    let hitsInserted = 0

    if (limitUpSymbols.length > 0) {
      // Step 3: Find open trade_records whose instrument starts with a limit-up symbol
      // instrument format: "2330 台積電" — symbol is the first part
      const { data: openTrades, error: tradeErr } = await supabase
        .from('trade_records')
        .select('id, expert_id, instrument, entry_price, entry_date')
        .eq('status', 'open')

      if (tradeErr) console.error('trade query error:', tradeErr)

      const limitUpSet = new Set(limitUpSymbols)
      const matchedTrades = (openTrades || []).filter(t => {
        const sym = t.instrument?.split(' ')?.[0]
        return sym && limitUpSet.has(sym)
      })

      // Also check: entry_date <= today (the position was already open)
      const hitRows = matchedTrades
        .filter(t => {
          if (!t.entry_date) return true
          return t.entry_date.split('T')[0] <= tradeDate
        })
        .map(t => {
          const sym = t.instrument.split(' ')[0]
          const snap = snapshotRows.find(s => s.symbol === sym)
          return {
            expert_id: t.expert_id,
            symbol: sym,
            instrument: t.instrument,
            trade_date: tradeDate,
            close_price: snap?.close_price ?? null,
            entry_price: t.entry_price,
            trade_record_id: t.id,
          }
        })

      if (hitRows.length > 0) {
        const { error: hitErr } = await supabase
          .from('expert_limit_up_hits')
          .upsert(hitRows, { onConflict: 'expert_id,symbol,trade_date' })
        if (hitErr) console.error('hits upsert error:', hitErr)
        else hitsInserted = hitRows.length
      }
    }

    // Audit log
    await supabase.from('audit_logs').insert({
      action: 'daily_snapshot',
      detail: {
        trade_date: tradeDate,
        snapshots: snapshotRows.length,
        limit_up_symbols: limitUpSymbols.length,
        hits_inserted: hitsInserted,
      },
    })

    return new Response(JSON.stringify({
      success: true,
      trade_date: tradeDate,
      snapshots: snapshotRows.length,
      limit_up_count: limitUpSymbols.length,
      hits: hitsInserted,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    console.error('daily-snapshot error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
