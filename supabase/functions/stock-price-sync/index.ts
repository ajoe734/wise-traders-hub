import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parsePrice, extractPrice, shouldWritePrice, type MsgItem } from '../_shared/stockPriceWaterfall.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
]


async function fetchStockBatch(symbols: string[]): Promise<Map<string, { price: number; name: string; raw: MsgItem }>> {
  const results = new Map<string, { price: number; name: string; raw: MsgItem }>()
  
  // Build ex_ch: try both tse and otc for each
  const exChParts = symbols.flatMap(sym => [`tse_${sym}.tw`, `otc_${sym}.tw`])
  
  // Split into chunks of ~200
  const chunkSize = 200
  const chunks: string[][] = []
  for (let i = 0; i < exChParts.length; i += chunkSize) {
    chunks.push(exChParts.slice(i, i + chunkSize))
  }
  
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
  
  for (const chunk of chunks) {
    const exCh = chunk.join('|')
    const ts = Date.now()
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_=${ts}`
    
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': ua, 'Accept': 'application/json' },
      })
      const data = await res.json()
      const msgArray: MsgItem[] = data?.msgArray || []
      
      // Deduplicate by code, prefer entry with volume
      const bestByCode = new Map<string, MsgItem>()
      for (const item of msgArray) {
        if (!item.c) continue
        const existing = bestByCode.get(item.c)
        if (!existing) {
          bestByCode.set(item.c, item)
        } else {
          const existV = parseInt(existing.v || '0', 10)
          const newV = parseInt(item.v || '0', 10)
          if (newV > existV) bestByCode.set(item.c, item)
        }
      }
      
      for (const [code, item] of bestByCode) {
        const price = extractPrice(item)
        if (shouldWritePrice(price)) {
          results.set(code, { price, name: item.n || '', raw: item })
        }
      }
    } catch (e) {
      console.error('TWSE fetch error for chunk:', e)
    }
    
    if (chunks.length > 1) {
      await new Promise(r => setTimeout(r, 500))
    }
  }
  
  return results
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

    // ── Step A: Collect all open symbols from trade_signals ──
    const { data: openSignals, error: sigError } = await supabase
      .from('trade_signals')
      .select('symbol, user_id, id, entry_price, name')
      .eq('status', 'open')

    if (sigError) throw sigError

    const allSymbols = [...new Set((openSignals || []).map(s => s.symbol).filter(Boolean))]

    if (allSymbols.length === 0) {
      return new Response(JSON.stringify({ message: 'No open positions', updated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Step B: Batch fetch prices from TWSE ──
    const priceMap = await fetchStockBatch(allSymbols)

    // ── Step C: Upsert to current_prices ──
    const now = new Date().toISOString()
    const priceRows = Array.from(priceMap.entries()).map(([symbol, { price, name, raw }]) => {
      const yClose = parsePrice(raw.y)
      const changeValue = yClose ? Math.round((price - yClose) * 100) / 100 : null
      const changePct = yClose && yClose > 0 ? Math.round(((price - yClose) / yClose) * 10000) / 100 : null
      
      return {
        symbol,
        name: name || null,
        price,
        open_price: parsePrice(raw.o),
        high_price: parsePrice(raw.h),
        low_price: parsePrice(raw.l),
        yesterday_close: yClose,
        change_value: changeValue,
        change_percent: changePct,
        volume: parseInt(raw.v || '0', 10) || null,
        best_ask: parsePrice(raw.a?.split('_')?.[0]),
        best_bid: parsePrice(raw.b?.split('_')?.[0]),
        limit_up: parsePrice(raw.u),
        limit_down: parsePrice(raw.w),
        pushed_at: now,
      }
    })

    if (priceRows.length > 0) {
      const { error: upsertErr } = await supabase
        .from('current_prices')
        .upsert(priceRows, { onConflict: 'symbol' })
      if (upsertErr) console.error('current_prices upsert error:', upsertErr)
    }

    // ── Step D: Calculate PnL and update user_performances ──
    const perfRows: any[] = []
    for (const sig of (openSignals || [])) {
      const priceData = priceMap.get(sig.symbol)
      const currentPrice = priceData?.price ?? null
      const entryPrice = sig.entry_price != null ? Number(sig.entry_price) : null
      
      const pnl = (currentPrice != null && entryPrice != null)
        ? Math.round((currentPrice - entryPrice) * 1000) / 1000
        : null
      const pnlPct = (currentPrice != null && entryPrice != null && entryPrice > 0)
        ? Math.round(((currentPrice - entryPrice) / entryPrice) * 10000) / 100
        : null
      
      perfRows.push({
        user_id: sig.user_id,
        signal_id: sig.id,
        symbol: sig.symbol,
        name: priceData?.name || sig.name || null,
        entry_price: entryPrice,
        current_price: currentPrice,
        pnl,
        pnl_percent: pnlPct,
        updated_at: now,
      })
    }

    if (perfRows.length > 0) {
      const { error: perfErr } = await supabase
        .from('user_performances')
        .upsert(perfRows, { onConflict: 'user_id,signal_id' })
      if (perfErr) console.error('user_performances upsert error:', perfErr)
    }

    // ── Step E: Update user_summaries ──
    const userIds = [...new Set((openSignals || []).map(s => s.user_id))]
    for (const uid of userIds) {
      const { data: userPerfs } = await supabase
        .from('user_performances')
        .select('pnl_percent')
        .eq('user_id', uid)

      if (userPerfs && userPerfs.length > 0) {
        const validPerfs = userPerfs.filter(p => p.pnl_percent != null)
        const totalPnl = validPerfs.reduce((sum, p) => sum + (p.pnl_percent || 0), 0)
        const avgPnl = validPerfs.length > 0
          ? Math.round((totalPnl / validPerfs.length) * 100) / 100
          : 0

        await supabase
          .from('user_summaries')
          .upsert({
            user_id: uid,
            total_pnl_percent: Math.round(totalPnl * 100) / 100,
            avg_pnl_percent: avgPnl,
            updated_at: now,
          }, { onConflict: 'user_id' })
      }
    }

    // ── Audit log ──
    await supabase.from('audit_logs').insert({
      action: 'stock_price_sync',
      detail: {
        symbols_total: allSymbols.length,
        prices_fetched: priceMap.size,
        performances_updated: perfRows.length,
        users_updated: userIds.length,
      },
    })

    return new Response(JSON.stringify({
      success: true,
      symbols: allSymbols.length,
      prices_fetched: priceMap.size,
      performances: perfRows.length,
      users: userIds.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    console.error('stock-price-sync error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
