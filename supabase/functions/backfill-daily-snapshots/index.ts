// 回填 TWSE 日 K 歷史資料到 daily_price_snapshots
// 用法：POST { months: 36, symbols?: string[], dryRun?: boolean }
// - 預設拉近 36 個月
// - 不指定 symbols 時，從 current_prices 撈所有上市/上櫃代號
// - TWSE STOCK_DAY API: https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=YYYYMM01&stockNo=XXXX
// 限速：每 3 秒一次請求避免被擋
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

interface TwseDayRow {
  date: string         // 民國年/月/日 e.g. "115/04/29"
  open: number
  high: number
  low: number
  close: number
  volume: number       // 成交股數
}

function rocToIso(roc: string): string | null {
  // "115/04/29" -> "2026-04-29"
  const m = roc.match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/)
  if (!m) return null
  const year = parseInt(m[1], 10) + 1911
  const month = m[2].padStart(2, '0')
  const day = m[3].padStart(2, '0')
  return `${year}-${month}-${day}`
}

function num(s: string): number | null {
  const n = parseFloat(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

async function fetchMonth(symbol: string, yyyymm: string): Promise<TwseDayRow[]> {
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${yyyymm}01&stockNo=${symbol}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  })
  if (!res.ok) {
    await res.text()
    return []
  }
  const json = await res.json().catch(() => null)
  if (!json || json.stat !== 'OK' || !Array.isArray(json.data)) return []
  // data 欄位順序: 日期, 成交股數, 成交金額, 開盤, 最高, 最低, 收盤, 漲跌價差, 成交筆數
  const rows: TwseDayRow[] = []
  for (const row of json.data) {
    const iso = rocToIso(row[0])
    if (!iso) continue
    const open = num(row[3])
    const high = num(row[4])
    const low = num(row[5])
    const close = num(row[6])
    const volume = num(row[1])
    if (close == null) continue
    rows.push({
      date: iso,
      open: open ?? close,
      high: high ?? close,
      low: low ?? close,
      close,
      volume: Math.round(volume ?? 0),
    })
  }
  return rows
}

function monthsBack(n: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const months: number = Math.min(Math.max(body.months ?? 36, 1), 60)
    const symbols: string[] | undefined = Array.isArray(body.symbols) && body.symbols.length > 0 ? body.symbols : undefined
    const dryRun: boolean = !!body.dryRun

    const sb = createClient(SUPABASE_URL, SERVICE_KEY)

    let targetSymbols: string[]
    if (symbols) {
      targetSymbols = symbols.map(String)
    } else {
      const { data, error } = await sb
        .from('current_prices')
        .select('symbol')
        .order('symbol')
      if (error) throw error
      targetSymbols = (data ?? []).map((r: any) => r.symbol).filter((s: string) => /^\d{4,6}$/.test(s))
    }

    if (dryRun) {
      return new Response(JSON.stringify({
        ok: true,
        dryRun: true,
        symbol_count: targetSymbols.length,
        months,
        estimated_requests: targetSymbols.length * months,
        estimated_minutes: Math.ceil((targetSymbols.length * months * 3) / 60),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const monthList = monthsBack(months)
    let inserted = 0
    let failed = 0
    const startedAt = Date.now()
    const TIME_BUDGET_MS = 50_000  // edge function 預設超時前先收手

    for (const symbol of targetSymbols) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break
      for (const ym of monthList) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) break
        try {
          const rows = await fetchMonth(symbol, ym)
          if (rows.length === 0) { failed++; continue }
          const upsertRows = rows.map(r => ({
            symbol,
            trade_date: r.date,
            open_price: r.open,
            high_price: r.high,
            low_price: r.low,
            close_price: r.close,
            volume: r.volume,
            is_limit_up: false,
          }))
          const { error } = await sb
            .from('daily_price_snapshots')
            .upsert(upsertRows, { onConflict: 'symbol,trade_date', ignoreDuplicates: false })
          if (error) {
            console.warn(`upsert ${symbol} ${ym} failed:`, error.message)
            failed++
          } else {
            inserted += upsertRows.length
          }
        } catch (e) {
          console.warn(`fetch ${symbol} ${ym} error:`, e)
          failed++
        }
        // 限速：每次 3 秒
        await new Promise(r => setTimeout(r, 3000))
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      symbols_requested: targetSymbols.length,
      months_requested: months,
      rows_inserted: inserted,
      failures: failed,
      partial: Date.now() - startedAt > TIME_BUDGET_MS,
      hint: 'Edge function 有 60s 上限。如果 partial=true，請拆批呼叫（例如每次傳 10-20 個 symbols）',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
