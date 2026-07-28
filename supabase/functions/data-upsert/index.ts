// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { corsHeaders } from '../_shared/cors.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { validateInput, validationResponse } from '../_shared/inputValidator.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

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

Deno.serve(withLogging('data-upsert', async (req) => {
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
    const body = await req.json().catch(() => ({}))
    // E-VALID-001: 強制 schema 驗證
    const issues = validateInput({
      fields: {
        action: { required: true, type: 'string', oneOf: ['select', 'upsert', 'insert'], label: 'action' },
        table: { required: true, type: 'string', label: 'table' },
        records: { type: 'array', label: 'records' },
        params: { type: 'object', label: 'params' },
        on_conflict: { type: 'string', label: 'on_conflict' },
        ignore_duplicates: { type: 'boolean', label: 'ignore_duplicates' },
      },
      source: body,
    });
    if (issues.length) return validationResponse(issues, corsHeaders);
    const { action, table, records, params, on_conflict, ignore_duplicates } = body

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
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}))
