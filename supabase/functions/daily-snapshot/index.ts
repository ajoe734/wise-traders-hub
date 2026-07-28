// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { corsHeaders } from '../_shared/cors.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { nyTradeDate, extractSymbol } from '../_shared/marketDetect.ts'

Deno.serve(withLogging('daily-snapshot', async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // TW trade_date：Asia/Taipei 曆日
    const now = new Date()
    const taipeiDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }))
    const twTradeDate = taipeiDate.toISOString().split('T')[0]
    // US trade_date：紐約時區（含 DST），週末回推到週五
    const usTradeDate = nyTradeDate(now)

    // Step 1: Read all current_prices（含 market）
    const { data: prices, error: pricesErr } = await supabase
      .from('current_prices')
      .select('symbol, price, yesterday_close, change_percent, limit_up, volume, market')

    if (pricesErr) throw pricesErr
    if (!prices || prices.length === 0) {
      return new Response(JSON.stringify({ message: 'No prices to snapshot', tw_date: twTradeDate, us_date: usTradeDate }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Build snapshot rows；美股 is_limit_up 恆 false（無 10% 漲跌停），trade_date 用 NY 曆日
    const snapshotRows = prices
      .filter((p: any) => p.price && p.price > 0)
      .map((p: any) => {
        const market = p.market === 'US' ? 'US' : 'TW'
        const isLimitUp =
          market === 'TW' && p.limit_up != null && p.price != null && p.price >= p.limit_up
        // current_prices.volume 對台股是「張」(lots)，美股/加密是「股」(shares)。
        // 明確標記 volume_unit，讓 DB trigger 統一算出 volume_shares，BSR 覆蓋率下游只讀 volume_shares。
        const volumeUnit = market === 'TW' ? 'lots' : 'shares'
        const rawVolume = p.volume == null ? null : Number(p.volume)
        const volumeShares =
          rawVolume == null ? null : volumeUnit === 'lots' ? rawVolume * 1000 : rawVolume
        return {
          symbol: p.symbol,
          trade_date: market === 'US' ? usTradeDate : twTradeDate,
          close_price: p.price,
          yesterday_close: p.yesterday_close,
          change_percent: p.change_percent,
          is_limit_up: isLimitUp,
          limit_up_price: market === 'TW' ? p.limit_up : null,
          volume: rawVolume,
          volume_unit: volumeUnit,
          volume_shares: volumeShares,
          market,
        }
      })

    if (snapshotRows.length > 0) {
      const { error: snapErr } = await supabase
        .from('daily_price_snapshots')
        .upsert(snapshotRows, { onConflict: 'symbol,trade_date' })
      if (snapErr) console.error('snapshot upsert error:', snapErr)
    }

    // Step 2: 漲停命中僅計算台股（美股無漲停）
    const limitUpSymbols = snapshotRows.filter((r) => r.market === 'TW' && r.is_limit_up).map((r) => r.symbol)

    let hitsInserted = 0

    if (limitUpSymbols.length > 0) {
      // Step 3: Find open trade_records whose instrument starts with a limit-up symbol
      const { data: openTrades, error: tradeErr } = await supabase
        .from('trade_records')
        .select('id, expert_id, instrument, entry_price, entry_date, market')
        .eq('status', 'open')

      if (tradeErr) console.error('trade query error:', tradeErr)

      const limitUpSet = new Set(limitUpSymbols)
      const matchedTrades = (openTrades || []).filter((t: any) => {
        if (t.market === 'US') return false // 美股不計漲停命中
        const sym = t.instrument?.split(' ')?.[0]
        return sym && limitUpSet.has(sym)
      })

      // Also check: entry_date <= today (the position was already open)
      const hitRows = matchedTrades
        .filter((t: any) => {
          if (!t.entry_date) return true
          return t.entry_date.split('T')[0] <= twTradeDate
        })
        .map((t: any) => {
          const sym = extractSymbol(t.instrument)
          const snap = snapshotRows.find((s) => s.symbol === sym)
          return {
            expert_id: t.expert_id,
            symbol: sym,
            instrument: t.instrument,
            trade_date: twTradeDate,
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

    const twCount = snapshotRows.filter((r) => r.market === 'TW').length
    const usCount = snapshotRows.filter((r) => r.market === 'US').length

    // System job log
    await supabase.from('system_jobs_log').insert({
      job_name: 'daily_snapshot',
      status: 'success',
      detail: {
        tw_trade_date: twTradeDate,
        us_trade_date: usTradeDate,
        snapshots_tw: twCount,
        snapshots_us: usCount,
        limit_up_symbols: limitUpSymbols.length,
        hits_inserted: hitsInserted,
      },
    })

    return new Response(JSON.stringify({
      success: true,
      tw_trade_date: twTradeDate,
      us_trade_date: usTradeDate,
      snapshots_tw: twCount,
      snapshots_us: usCount,
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
}))
