// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { corsHeaders } from '../_shared/cors.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
// 回填 TWSE 日 K 歷史資料到 daily_price_snapshots（含進度追蹤、續跑）
// 用法：
//   POST { months?: 36, symbols?: string[], dryRun?: boolean, resume?: true }
//   resume=true: 只跑 progress 表中 status != 'done' 的 (symbol, yyyymm)
// 進度寫入 knowledge_backfill_progress

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

interface TwseDayRow {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

function rocToIso(roc: string): string | null {
  const m = roc.match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/)
  if (!m) return null
  const year = parseInt(m[1], 10) + 1911
  const month = m[2].padStart(2, '0')
  const day = m[3].padStart(2, '0')
  return `${year}-${month}-${day}`
}

function num(s: string): number | null {
  const n = parseFloat(String(s).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

async function fetchMonth(symbol: string, yyyymm: string): Promise<TwseDayRow[]> {
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${yyyymm}01&stockNo=${symbol}`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) { await res.text(); return [] }
  const json = await res.json().catch(() => null)
  if (!json || json.stat !== 'OK' || !Array.isArray(json.data)) return []
  const rows: TwseDayRow[] = []
  for (const row of json.data) {
    const iso = rocToIso(row[0])
    if (!iso) continue
    const open = num(row[3]); const high = num(row[4])
    const low = num(row[5]); const close = num(row[6])
    const volume = num(row[1])
    if (close == null) continue
    rows.push({
      date: iso, open: open ?? close, high: high ?? close,
      low: low ?? close, close, volume: Math.round(volume ?? 0),
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

Deno.serve(withLogging('backfill-daily-snapshots', async (req) => {
  // AUTH: cron (Phase M-2 runtime enforcement)
  if (req.method !== 'OPTIONS') {
    try { requireCronKey(req); }
    catch (e) {
      if (e instanceof AuthError) {
        return new Response(JSON.stringify({ error: e.message, code: e.code }), {
          status: e.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      throw e;
    }
  }

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const months: number = Math.min(Math.max(body.months ?? 36, 1), 60)
    const symbols: string[] | undefined = Array.isArray(body.symbols) && body.symbols.length > 0 ? body.symbols : undefined
    const dryRun: boolean = !!body.dryRun
    const resume: boolean = !!body.resume

    const sb = serviceClient()

    // 1. 計算目標 (symbol, yyyymm) 清單
    let targetSymbols: string[]
    if (symbols) {
      targetSymbols = symbols.map(String)
    } else {
      const { data, error } = await sb.from('current_prices').select('symbol').order('symbol')
      if (error) throw error
      targetSymbols = (data ?? []).map((r: any) => r.symbol).filter((s: string) => /^\d{4,6}[A-Z]?$/i.test(s))
    }
    const monthList = monthsBack(months)

    // 2. 寫入或補齊 progress 表（pending 狀態）
    if (!resume && !dryRun) {
      const upserts: any[] = []
      for (const symbol of targetSymbols) {
        for (const ym of monthList) {
          upserts.push({ symbol, yyyymm: ym, status: 'pending' })
        }
      }
      // 分批 upsert（每批 1000）
      for (let i = 0; i < upserts.length; i += 1000) {
        const chunk = upserts.slice(i, i + 1000)
        await sb.from('knowledge_backfill_progress')
          .upsert(chunk, { onConflict: 'symbol,yyyymm', ignoreDuplicates: true })
      }
    }

    if (dryRun) {
      // 統計
      const { data: progressStats } = await sb
        .from('knowledge_backfill_progress')
        .select('status', { count: 'exact', head: false })
      return new Response(JSON.stringify({
        ok: true,
        dryRun: true,
        symbol_count: targetSymbols.length,
        months,
        estimated_requests: targetSymbols.length * months,
        estimated_minutes: Math.ceil((targetSymbols.length * months * 3) / 60),
        existing_progress_rows: progressStats?.length ?? 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 3. 取下一批要跑的 (symbol, yyyymm)
    const { data: pendingRows, error: pErr } = await sb
      .from('knowledge_backfill_progress')
      .select('id,symbol,yyyymm')
      .neq('status', 'done')
      .order('symbol')
      .order('yyyymm')
      .limit(200) // 一次 edge function 最多 200 個請求（搭配 1.2s 限速 + 55s budget）
    if (pErr) throw pErr

    let inserted = 0
    let processed = 0
    let failed = 0
    const startedAt = Date.now()
    const TIME_BUDGET_MS = 55_000

    for (const job of (pendingRows ?? [])) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break
      processed++
      try {
        const rows = await fetchMonth(job.symbol, job.yyyymm)
        if (rows.length === 0) {
          await sb.from('knowledge_backfill_progress').update({
            status: 'empty', attempted_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          }).eq('id', job.id)
          continue
        }
        // TWSE STOCK_DAY row[1]=成交股數（股）；明確標記 volume_unit='shares'，trigger 會補 volume_shares。
        const upsertRows = rows.map(r => ({
          symbol: job.symbol, trade_date: r.date, market: 'TW',
          open_price: r.open, high_price: r.high, low_price: r.low,
          close_price: r.close, volume: r.volume,
          volume_unit: 'shares', volume_shares: r.volume,
          is_limit_up: false,
        }))
        const { error } = await sb.from('daily_price_snapshots')
          .upsert(upsertRows, { onConflict: 'symbol,trade_date', ignoreDuplicates: false })
        if (error) {
          await sb.from('knowledge_backfill_progress').update({
            status: 'failed', attempted_at: new Date().toISOString(),
            error_message: error.message,
          }).eq('id', job.id)
          failed++
        } else {
          inserted += upsertRows.length
          await sb.from('knowledge_backfill_progress').update({
            status: 'done', rows_inserted: upsertRows.length,
            attempted_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            error_message: null,
          }).eq('id', job.id)
        }
      } catch (e) {
        await sb.from('knowledge_backfill_progress').update({
          status: 'failed', attempted_at: new Date().toISOString(),
          error_message: String(e),
        }).eq('id', job.id)
        failed++
      }
      await new Promise(r => setTimeout(r, 1200)) // 限速：1.2s/req（TWSE 容忍範圍）
    }

    // 進度總覽
    const { data: summary } = await sb.rpc('exec_count', {} as any).select?.() ?? { data: null }
    const { count: doneCount } = await sb.from('knowledge_backfill_progress')
      .select('*', { count: 'exact', head: true }).eq('status', 'done')
    const { count: pendingCount } = await sb.from('knowledge_backfill_progress')
      .select('*', { count: 'exact', head: true }).eq('status', 'pending')
    const { count: failedCount } = await sb.from('knowledge_backfill_progress')
      .select('*', { count: 'exact', head: true }).eq('status', 'failed')
    const { count: totalCount } = await sb.from('knowledge_backfill_progress')
      .select('*', { count: 'exact', head: true })

    // 自動觸發 knowledge-backtest：本批有處理 && 已無 pending（剛清空）
    let auto_backtest_triggered = false
    if (processed > 0 && (pendingCount ?? 0) === 0) {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/knowledge-backtest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({ mode: 'full', trigger: 'auto_after_backfill' }),
        })
        auto_backtest_triggered = true
      } catch (e) {
        console.error('auto-trigger knowledge-backtest failed:', e)
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      this_batch: { processed, rows_inserted: inserted, failures: failed },
      progress: {
        done: doneCount ?? 0,
        pending: pendingCount ?? 0,
        failed: failedCount ?? 0,
        total: totalCount ?? 0,
      },
      partial: (pendingCount ?? 0) > 0,
      auto_backtest_triggered,
      hint: (pendingCount ?? 0) > 0 ? '尚有未完成批次，自動續跑中…' : '回填完成 ✅',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
}))
