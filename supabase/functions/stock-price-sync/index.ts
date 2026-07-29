// AUTH: public  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { corsHeaders } from '../_shared/cors.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { parsePrice, extractPrice, shouldWritePrice, type MsgItem } from '../_shared/stockPriceWaterfall.ts'
import { detectMarket, isDerivativeMarket, type Market } from '../_shared/marketDetect.ts'
import { fetchUsQuotes } from '../_shared/usStockPriceWaterfall.ts'

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
]


// 權證代號常見前綴：0/3/5/6/7 + 5 碼數字（牛熊證/認購/認售）
const isWarrantLike = (sym: string) => /^[03567]\d{5}$/.test(sym)

async function fetchTpexFallback(symbols: string[]): Promise<Map<string, { price: number; name: string; raw: MsgItem }>> {
  const out = new Map<string, { price: number; name: string; raw: MsgItem }>()
  if (symbols.length === 0) return out
  try {
    const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/tpex-proxy?endpoint=SQUOTE_EW_QUOTAS_ALL&codes=${symbols.join(',')}`
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const r = await fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (!r.ok) return out
    const arr = await r.json()
    if (!Array.isArray(arr)) return out
    for (const item of arr) {
      const code = item.SecuritiesCompanyCode || item.Code
      const priceStr = item.Close ?? item.ClosingPrice ?? item.LatestTradePrice
      const price = parseFloat(priceStr)
      if (code && Number.isFinite(price) && price > 0) {
        out.set(code, {
          price,
          name: item.CompanyName || item.Name || '',
          raw: { c: code, z: String(price), n: item.CompanyName || '' } as any,
        })
      }
    }
  } catch (e) {
    console.error('TPEx fallback fetch error:', e)
  }
  return out
}

async function fetchStockBatch(symbols: string[]): Promise<Map<string, { price: number; name: string; raw: MsgItem }>> {
  const results = new Map<string, { price: number; name: string; raw: MsgItem }>()
  
  // Build ex_ch: try tse, otc, and oa(權證/盤後零股) for each
  const exChParts = symbols.flatMap(sym => {
    const base = [`tse_${sym}.tw`, `otc_${sym}.tw`]
    if (isWarrantLike(sym) || sym.length >= 6) base.push(`oa_${sym}.tw`)
    return base
  })
  
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
        if (shouldWritePrice(price) && price !== null) {
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
  
  // TPEx fallback：MIS 抓不到的 symbol（多為上櫃冷門股 / 權證），補打 TPEx OpenAPI（每日收盤資料）
  const missing = symbols.filter(s => !results.has(s))
  if (missing.length > 0) {
    const tpexMap = await fetchTpexFallback(missing)
    for (const [code, v] of tpexMap) {
      if (!results.has(code)) results.set(code, v)
    }
  }
  
  return results
}

Deno.serve(withLogging('stock-price-sync', async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // ── Parse body（symbols mode for manual backfill）──
    let force = new URL(req.url).searchParams.get('force') === '1'
    let requestedSymbols: string[] | null = null
    // market gate: 'TW' | 'US' | 'BOTH'（預設 BOTH，向下相容）
    let marketGate: 'TW' | 'US' | 'BOTH' = 'BOTH'
    if (req.method === 'POST') {
      try {
        const body = await req.clone().json()
        if (body?.force === true || body?.force === '1') force = true
        if (Array.isArray(body?.symbols) && body.symbols.length > 0) {
          requestedSymbols = body.symbols.map((s: unknown) => String(s || '').trim()).filter(Boolean)
          force = true // symbols mode 一律繞過交易時段
        }
        const m = String(body?.market || '').toUpperCase()
        if (m === 'TW' || m === 'US') marketGate = m as 'TW' | 'US'
      } catch { /* body 不是 JSON 就忽略 */ }
    }

    const tw = new Date(Date.now() + 8 * 3600 * 1000)
    const dow = tw.getUTCDay()
    const minutes = tw.getUTCHours() * 60 + tw.getUTCMinutes()
    const isWeekday = dow >= 1 && dow <= 5
    // TW: 09:00-14:10 Taipei（含 13:35 收盤 tail 與 14:05 官方收盤定價 correction cron）
    // US: 21:30-04:30 Taipei（美東 09:30-16:00 標準 / 08:30-15:00 DST 期間放寬）
    const twInWindow = minutes >= 9 * 60 && minutes <= 14 * 60 + 10
    const usInWindow = (minutes >= 21 * 60) || (minutes <= 4 * 60 + 30)
    const anyWindow =
      (marketGate === 'TW' && twInWindow) ||
      (marketGate === 'US' && usInWindow) ||
      (marketGate === 'BOTH' && (twInWindow || usInWindow))
    if (!force && !(isWeekday && anyWindow)) {
      return new Response(JSON.stringify({ skipped: true, reason: 'outside_trading_hours', market: marketGate }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // ── Resolve caller user_id (for miss logging in symbols mode) ──
    let callerUserId: string | null = null
    if (requestedSymbols) {
      const authHeader = req.headers.get('Authorization') || ''
      const token = authHeader.replace(/^Bearer\s+/i, '')
      if (token) {
        try {
          const { data } = await supabase.auth.getUser(token)
          callerUserId = data?.user?.id || null
        } catch { /* ignore */ }
      }
    }

    // ── Helper: log miss / resolve ──
    const SENTINEL = '00000000-0000-0000-0000-000000000000'
    async function logMiss(symbol: string, reason: string, lastError: string | null) {
      const uid = callerUserId
      const now = new Date().toISOString()
      // Try update first
      const { data: existing } = await supabase
        .from('checkup_price_misses')
        .select('id, attempts')
        .eq('symbol', symbol)
        .is('user_id', uid as any)
        .maybeSingle()
      if (existing?.id) {
        await supabase.from('checkup_price_misses').update({
          attempts: (existing.attempts || 0) + 1,
          last_seen_at: now,
          reason,
          last_error: lastError,
          resolved_at: null,
        }).eq('id', existing.id)
      } else {
        await supabase.from('checkup_price_misses').insert({
          user_id: uid,
          symbol,
          reason,
          attempts: 1,
          last_error: lastError,
          first_seen_at: now,
          last_seen_at: now,
        })
      }
    }
    async function resolveMiss(symbol: string) {
      await supabase.from('checkup_price_misses')
        .update({ resolved_at: new Date().toISOString() })
        .eq('symbol', symbol)
        .is('user_id', callerUserId as any)
        .is('resolved_at', null)
    }

    // ──────────── SYMBOLS MODE: 手動補抓特定代碼（TW + US 分流）────────────
    if (requestedSymbols) {
      const reasons: Record<string, string> = {}
      const twSyms: string[] = []
      const usSyms: string[] = []
      for (const sym of requestedSymbols) {
        const m = detectMarket(sym)
        if (isDerivativeMarket(m)) {
          reasons[sym] = 'derivative_manual_only'
          continue
        }
        if (m === 'TW') {
          if (/^\d{4,6}[A-Z]?$/i.test(sym)) twSyms.push(sym.toUpperCase())
          else reasons[sym] = 'invalid_format'
        } else {
          usSyms.push(sym.toUpperCase())
        }
      }

      const twMap = twSyms.length > 0
        ? await fetchStockBatch(twSyms)
        : new Map<string, { price: number; name: string; raw: MsgItem }>()
      const usMap = usSyms.length > 0
        ? await fetchUsQuotes(usSyms)
        : new Map<string, any>()

      const now = new Date().toISOString()
      const twRows = Array.from(twMap.entries()).map(([symbol, { price, name, raw }]) => {
        const yClose = parsePrice(raw.y)
        const changeValue = yClose ? Math.round((price - yClose) * 100) / 100 : null
        const changePct = yClose && yClose > 0 ? Math.round(((price - yClose) / yClose) * 10000) / 100 : null
        return {
          symbol, name: name || null, price, market: 'TW', currency: 'TWD', asset_class: 'tw_stock',
          open_price: parsePrice(raw.o), high_price: parsePrice(raw.h), low_price: parsePrice(raw.l),
          yesterday_close: yClose, change_value: changeValue, change_percent: changePct,
          volume: parseInt(raw.v || '0', 10) || null,
          best_ask: parsePrice(raw.a?.split('_')?.[0]),
          best_bid: parsePrice(raw.b?.split('_')?.[0]),
          limit_up: parsePrice(raw.u), limit_down: parsePrice(raw.w),
          updated_at: now,
        }
      })
      const usRows = Array.from(usMap.values()).map((q: any) => ({
        symbol: q.symbol, name: q.name, price: q.price, market: 'US', currency: 'USD', asset_class: 'us_stock',
        open_price: q.open_price, high_price: q.high_price, low_price: q.low_price,
        yesterday_close: q.yesterday_close, change_value: q.change_value, change_percent: q.change_percent,
        volume: q.volume,
        best_ask: null, best_bid: null,
        limit_up: null, limit_down: null,
        updated_at: now,
      }))
      const priceRows = [...twRows, ...usRows]
      if (priceRows.length > 0) {
        const { error: upErr } = await supabase.rpc('upsert_current_price', {
          p_writer: 'stock-price-sync',
          p_rows: priceRows,
        })
        if (upErr) console.error('upsert_current_price error:', upErr)
      }

      for (const sym of twSyms) {
        if (!twMap.has(sym)) reasons[sym] = 'not_found'
      }
      for (const sym of usSyms) {
        if (!usMap.has(sym)) reasons[sym] = 'not_found'
      }

      const missing = Object.keys(reasons)
      const foundSet = new Set<string>([
        ...Array.from(twMap.keys()),
        ...Array.from(usMap.keys()),
      ])
      for (const sym of requestedSymbols) {
        const key = /^\d/.test(sym) ? sym : sym.toUpperCase()
        if (reasons[sym]) {
          await logMiss(sym, reasons[sym], null)
        } else if (foundSet.has(key)) {
          await resolveMiss(sym)
        }
      }

      return new Response(JSON.stringify({
        success: true,
        mode: 'symbols',
        requested: requestedSymbols,
        fetched_tw: twMap.size,
        fetched_us: usMap.size,
        missing,
        reasons,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    // ──────────── 以下為原本的全量同步邏輯（TW + US 分流）────────────

    // ── Step A: Collect symbols from trade_signals AND checkup_storage (Free Checkup holdings) ──
    // 亦匯入 trade_records（含 expert US 持倉）的美股代碼，以便美股 cron 也能刷新現價。
    const { data: openSignals, error: sigError } = await supabase
      .from('trade_signals')
      .select('symbol, user_id, id, entry_price, name')
      .eq('status', 'open')

    if (sigError) throw sigError

    // Free Checkup holdings (key='pf-holdings-v2') — 目前只放台股代碼
    const { data: checkupRows, error: chkError } = await supabase
      .from('checkup_storage')
      .select('data')
      .eq('key', 'pf-holdings-v2')

    if (chkError) console.error('checkup_storage fetch error:', chkError)

    const checkupSymbols = new Set<string>()
    for (const row of (checkupRows || [])) {
      const arr = Array.isArray(row?.data) ? row.data : []
      for (const h of arr) {
        const code = String(h?.code || '').trim().toUpperCase()
        if (code && /^\d{4,6}[A-Z]?$/i.test(code)) checkupSymbols.add(code)
      }
    }

    // trade_records instrument → symbol（供美股代碼進入 US 分流）
    const { data: openTradeRecords } = await supabase
      .from('trade_records')
      .select('instrument, market')
      .eq('status', 'open')
    const recordSymbols = new Set<string>()
    for (const t of (openTradeRecords || [])) {
      const sym = String((t as any).instrument || '').trim().split(/\s+/)[0]
      if (sym) recordSymbols.add(sym)
    }

    const signalSymbols = (openSignals || []).map(s => s.symbol).filter(Boolean)
    const allSymbolsRaw = [...new Set([...signalSymbols, ...checkupSymbols, ...recordSymbols])]

    // 依 market 分兩批；再依 marketGate 過濾（TW-only cron 就跳過美股）
    const twSymbols = allSymbolsRaw.filter(s => detectMarket(s) === 'TW')
    const usSymbols = allSymbolsRaw.filter(s => detectMarket(s) === 'US').map(s => s.toUpperCase())
    const runTw = marketGate === 'TW' || marketGate === 'BOTH'
    const runUs = marketGate === 'US' || marketGate === 'BOTH'

    if (twSymbols.length === 0 && usSymbols.length === 0) {
      return new Response(JSON.stringify({ message: 'No open positions', updated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log(`Sync market=${marketGate}: TW=${twSymbols.length} US=${usSymbols.length} (runTw=${runTw} runUs=${runUs})`)

    // ── Step B: Batch fetch prices ──
    const twMap = runTw && twSymbols.length > 0
      ? await fetchStockBatch(twSymbols)
      : new Map<string, { price: number; name: string; raw: MsgItem }>()
    const usMap = runUs && usSymbols.length > 0
      ? await fetchUsQuotes(usSymbols)
      : new Map<string, any>()

    // 統一介面：symbol → { price, name, market, currency, ...meta }
    type UnifiedRow = {
      symbol: string; name: string | null; price: number; market: Market; currency: 'TWD' | 'USD';
      open_price: number | null; high_price: number | null; low_price: number | null;
      yesterday_close: number | null; change_value: number | null; change_percent: number | null;
      volume: number | null; best_ask: number | null; best_bid: number | null;
      limit_up: number | null; limit_down: number | null; pushed_at: string;
    }
    const now = new Date().toISOString()
    const priceRows: UnifiedRow[] = []

    for (const [symbol, { price, name, raw }] of twMap) {
      const yClose = parsePrice(raw.y)
      const changeValue = yClose ? Math.round((price - yClose) * 100) / 100 : null
      const changePct = yClose && yClose > 0 ? Math.round(((price - yClose) / yClose) * 10000) / 100 : null
      priceRows.push({
        symbol, name: name || null, price, market: 'TW', currency: 'TWD',
        open_price: parsePrice(raw.o), high_price: parsePrice(raw.h), low_price: parsePrice(raw.l),
        yesterday_close: yClose, change_value: changeValue, change_percent: changePct,
        volume: parseInt(raw.v || '0', 10) || null,
        best_ask: parsePrice(raw.a?.split('_')?.[0]),
        best_bid: parsePrice(raw.b?.split('_')?.[0]),
        limit_up: parsePrice(raw.u), limit_down: parsePrice(raw.w),
        pushed_at: now,
      })
    }
    for (const q of usMap.values()) {
      priceRows.push({
        symbol: (q as any).symbol, name: (q as any).name, price: (q as any).price,
        market: 'US', currency: 'USD',
        open_price: (q as any).open_price, high_price: (q as any).high_price, low_price: (q as any).low_price,
        yesterday_close: (q as any).yesterday_close,
        change_value: (q as any).change_value, change_percent: (q as any).change_percent,
        volume: (q as any).volume,
        best_ask: null, best_bid: null,
        limit_up: null, limit_down: null,
        pushed_at: now,
      })
    }

    if (priceRows.length > 0) {
      const rpcRows = priceRows.map((r) => ({
        ...r,
        asset_class: r.market === 'US' ? 'us_stock' : 'tw_stock',
        updated_at: now,
      }))
      const { error: upsertErr } = await supabase.rpc('upsert_current_price', {
        p_writer: 'stock-price-sync',
        p_rows: rpcRows,
      })
      if (upsertErr) console.error('upsert_current_price error:', upsertErr)
    }

    // 兼容原 priceMap 名稱：後續 user_performances 只走 trade_signals（TW-centric）
    const priceMap = new Map<string, { price: number; name: string }>()
    for (const r of priceRows) priceMap.set(r.symbol, { price: r.price, name: r.name || '' })

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

    // ── System job log ──
    await supabase.from('system_jobs_log').insert({
      job_name: 'stock_price_sync',
      status: 'success',
      detail: {
        market: marketGate,
        symbols_tw: twSymbols.length,
        symbols_us: usSymbols.length,
        prices_fetched: priceMap.size,
        performances_updated: perfRows.length,
        users_updated: userIds.length,
      },
    })

    return new Response(JSON.stringify({
      success: true,
      market: marketGate,
      symbols_tw: twSymbols.length,
      symbols_us: usSymbols.length,
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
}))
