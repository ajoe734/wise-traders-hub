// AUTH: public  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { validateInput, validationResponse } from '../_shared/inputValidator.ts'
import { applyCoercion } from '../_shared/inputCoerce.ts'

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/121.0.0.0',
]

Deno.serve(withLogging('stock-name-lookup', async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    let body: any = {}
    try { body = await req.json() } catch { body = {} }

    const fields = {
      symbols: {
        required: true, type: 'array' as const, minItems: 1,
        coerce: 'stocksArray',
        acceptTypes: ['string' as const],
        label: 'symbols',
        example: '["2330", "2317"]',
        hint: '股票代碼陣列，可傳字串（會以頓號/逗號自動拆分）或陣列',
      },
    }
    body = applyCoercion(fields as any, body).source
    const issues = validateInput({ fields: fields as any, source: body })
    if (issues.length) return validationResponse(issues, corsHeaders)

    const { symbols } = body


    // Cap at 200 symbols per request
    const uniqueSymbols: string[] = [...new Set((symbols as unknown[]).map((s) => String(s).trim()))].slice(0, 200)

    const supabase = serviceClient()

    // 1. Check DB cache first
    const { data: cached } = await supabase
      .from('stock_names')
      .select('symbol, name')
      .in('symbol', uniqueSymbols)

    const result: Record<string, string> = {}
    const missing: string[] = []

    for (const sym of uniqueSymbols) {
      const found = cached?.find(c => c.symbol === sym)
      if (found) {
        result[sym] = found.name
      } else {
        missing.push(sym)
      }
    }

    // 2. If all found in cache, return immediately
    if (missing.length === 0) {
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Batch fetch missing from TWSE MIS API
    // Build ex_ch string: try both tse and otc for each symbol
    const exChParts = missing.flatMap(sym => [`tse_${sym}.tw`, `otc_${sym}.tw`])

    // Split into chunks of ~200 ex_ch entries (100 symbols × 2)
    const chunkSize = 200
    const chunks: string[][] = []
    for (let i = 0; i < exChParts.length; i += chunkSize) {
      chunks.push(exChParts.slice(i, i + chunkSize))
    }

    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
    const fetchedNames: { symbol: string; name: string }[] = []

    for (const chunk of chunks) {
      const exCh = chunk.join('|')
      const ts = Date.now()
      const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_=${ts}`

      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': ua, 'Accept': 'application/json' },
        })
        const data = await res.json()
        const msgArray = data?.msgArray || []

        // Deduplicate: same code may appear twice (tse + otc), keep the one with valid data
        const bestByCode = new Map<string, { c: string; n: string; v: string }>()
        for (const item of msgArray) {
          if (!item.c || !item.n) continue
          if (!bestByCode.has(item.c)) {
            bestByCode.set(item.c, item)
          } else {
            // Prefer the one with volume
            const existing = bestByCode.get(item.c)!
            const existV = parseInt(existing.v || '0', 10)
            const newV = parseInt(item.v || '0', 10)
            if (newV > existV) bestByCode.set(item.c, item)
          }
        }

        for (const [code, item] of bestByCode) {
          if (item.n && !result[code]) {
            result[code] = item.n
            fetchedNames.push({ symbol: code, name: item.n })
          }
        }
      } catch (e) {
        console.error('TWSE MIS fetch error:', e)
      }

      // Small delay between chunks to avoid rate limiting
      if (chunks.length > 1) {
        await new Promise(r => setTimeout(r, 300))
      }
    }

    // 4. Upsert fetched names to stock_names table
    if (fetchedNames.length > 0) {
      const { error: upsertError } = await supabase
        .from('stock_names')
        .upsert(fetchedNames, { onConflict: 'symbol' })

      if (upsertError) {
        console.error('Upsert stock_names error:', upsertError)
      }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    console.error('stock-name-lookup error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}))
