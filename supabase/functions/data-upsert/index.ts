import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
}

// Whitelist of tables that can be operated on
const ALLOWED_TABLES = new Set([
  'current_prices',
  'trade_signals',
  'trade_records',
  'user_performances',
  'user_summaries',
])

function extractApiKey(req: Request): string | null {
  // Support x-api-key header
  const xApiKey = req.headers.get('x-api-key')
  if (xApiKey) return xApiKey
  // Support Authorization: Bearer <key>
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // 1. Verify API key
    const apiKey = extractApiKey(req)
    const expectedKey = Deno.env.get('DATA_UPSERT_API_KEY')
    if (!apiKey || apiKey !== expectedKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Parse body
    const body = await req.json()
    const { action, table, records, params, on_conflict, ignore_duplicates } = body

    if (!table) {
      return new Response(JSON.stringify({ error: 'Missing table' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Check whitelist
    if (!ALLOWED_TABLES.has(table)) {
      return new Response(JSON.stringify({ error: `Table "${table}" is not allowed` }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 4. Init Supabase service role client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 5. Handle SELECT action
    if (action === 'select') {
      let query = supabase.from(table).select('*')

      // Apply filters from params
      if (params && typeof params === 'object') {
        for (const [key, value] of Object.entries(params)) {
          query = query.eq(key, value)
        }
      }

      const { data, error: dbError } = await query

      if (dbError) {
        return new Response(JSON.stringify({ error: dbError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ data: data || [] }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 6. Handle UPSERT action (default)
    if (!records || !Array.isArray(records) || records.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing records for upsert' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (records.length > 500) {
      return new Response(JSON.stringify({ error: 'Max 500 records per request' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Sanitize user_performances: cross-check current_prices table
    let sanitizedRecords = records
    if (table === 'user_performances') {
      // Collect unique symbols from records
      const symbols = [...new Set(records.map((r: any) => r.symbol).filter(Boolean))]
      
      // Fetch current prices for these symbols
      const priceMap = new Map<string, number>()
      if (symbols.length > 0) {
        const { data: priceData } = await supabase
          .from('current_prices')
          .select('symbol, price')
          .in('symbol', symbols)
        
        ;(priceData || []).forEach((p: any) => {
          if (p.price != null) priceMap.set(p.symbol, Number(p.price))
        })
      }

      sanitizedRecords = records.map((r: any) => {
        const livePrice = priceMap.get(r.symbol)
        if (livePrice != null) {
          // Use live price from current_prices
          const entryPrice = r.entry_price != null ? Number(r.entry_price) : null
          const pnl = entryPrice != null ? Math.round((livePrice - entryPrice) * 1000) / 1000 : null
          const pnlPercent = entryPrice != null && entryPrice > 0
            ? Math.round(((livePrice - entryPrice) / entryPrice) * 10000) / 100
            : null
          return { ...r, current_price: livePrice, pnl, pnl_percent: pnlPercent }
        }
        // No live price available — set current_price/pnl/pnl_percent to null
        return { ...r, current_price: null, pnl: null, pnl_percent: null }
      })
    }

    const options: any = {}
    if (on_conflict) options.onConflict = on_conflict
    if (ignore_duplicates) options.ignoreDuplicates = true

    const { error: dbError } = await supabase
      .from(table)
      .upsert(sanitizedRecords, options)

    if (dbError) {
      return new Response(JSON.stringify({ error: dbError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true, count: records.length }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
