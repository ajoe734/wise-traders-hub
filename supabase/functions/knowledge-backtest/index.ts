// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// 知識庫歷史回測引擎
// 模式:
//   - mode=single: 對單一 knowledge item 用其當前 trigger_condition 跑回測
//   - mode=full: 對所有 backtestable=true 的 active items 跑回測
//   - mode=grid_search: 對單一 item 跑參數網格，找最佳組合並可選擇歸檔升級
//
// 支援 6 種 trigger type：
//   foreign_buy_streak / volume_price_surge / ma_breakdown
//   kd_golden_cross / revenue_yoy / gap_up
//
// 結果寫入：
//   - knowledge_backtest_runs: 一次 run 的摘要
//   - checkup_knowledge_validations: 每個 hit 的個別評估
//   - checkup_knowledge_items: 更新 win_rate / sample_size / backtest_stats
//   - knowledge_grid_search_results: 網格每格結果（grid_search mode）

import { jsonResponse, errorResponse } from '../_shared/cors.ts'
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { withLogging } from '../_shared/edgeLogger.ts'
import { serviceClient } from '../_shared/supabaseClients.ts'

// ---- 型別 ----
interface PriceRow {
  symbol: string
  trade_date: string  // YYYY-MM-DD
  open_price: number | null
  high_price: number | null
  low_price: number | null
  close_price: number
  volume: number | null
}

interface KnowledgeItem {
  id: string
  item_id: string
  trigger_condition: any
  expected_outcome: any
  confidence: number
}

interface Hit {
  symbol: string
  trigger_date: string
  details: Record<string, any>
}

interface BacktestStats {
  total_hits: number
  win_count: number
  loss_count: number
  win_rate: number | null
  avg_return_pct: number | null
  median_return_pct: number | null
  max_drawdown: number | null
}

// ---- 工具：把 PriceRow[] 依 symbol 分組並按日期排序 ----
function groupBySymbol(rows: PriceRow[]): Map<string, PriceRow[]> {
  const m = new Map<string, PriceRow[]>()
  for (const r of rows) {
    if (!m.has(r.symbol)) m.set(r.symbol, [])
    m.get(r.symbol)!.push(r)
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => a.trade_date.localeCompare(b.trade_date))
  }
  return m
}

// ---- 6 種 trigger 的偵測器 ----
// 每個偵測器吃 (symbol, sortedRows, params) → Hit[]
// 為了在 daily_price_snapshots 上能跑，我們用「能用 OHLCV 推出」的近似版本：
//   foreign_buy_streak: 近似為「連續 N 日收紅 + 量比 ≥ X」（真實外資資料還沒接）
//   volume_price_surge: 量 ≥ 5日均量的 X 倍 + 漲幅 ≥ Y%
//   ma_breakdown: 收盤跌破 N 日均線（前一日仍在均線上）
//   kd_golden_cross: 用 KD(9,3,3) 計算，K 由下穿上 D 且 K < oversold
//   revenue_yoy: （需 monthly_revenue 表，目前 fallback 為「月初股價漲幅 ≥ X%」）
//   gap_up: 開盤 ≥ 前日收盤 × (1 + min_gap_pct/100)

function pctChange(a: number, b: number): number {
  if (!b) return 0
  return ((a - b) / b) * 100
}

function detectVolumePriceSurge(symbol: string, rows: PriceRow[], p: any): Hit[] {
  const hits: Hit[] = []
  const minVolRatio = Number(p.min_volume_ratio ?? 2.0)
  const minPriceChange = Number(p.min_price_change_pct ?? 3)
  for (let i = 5; i < rows.length; i++) {
    const r = rows[i]
    const prev = rows[i - 1]
    if (!r.volume || !prev?.close_price) continue
    const vol5 = rows.slice(i - 5, i).reduce((s, x) => s + (x.volume ?? 0), 0) / 5
    if (!vol5) continue
    const volRatio = r.volume / vol5
    const change = pctChange(r.close_price, prev.close_price)
    if (volRatio >= minVolRatio && change >= minPriceChange) {
      hits.push({
        symbol, trigger_date: r.trade_date,
        details: { vol_ratio: +volRatio.toFixed(2), price_change_pct: +change.toFixed(2) }
      })
    }
  }
  return hits
}

function detectMaBreakdown(symbol: string, rows: PriceRow[], p: any): Hit[] {
  const period = Math.max(2, Math.min(240, Number(p.ma_period ?? 20)))
  const direction = String(p.direction ?? 'break_below')
  const hits: Hit[] = []
  for (let i = period; i < rows.length; i++) {
    const window = rows.slice(i - period, i)
    const ma = window.reduce((s, x) => s + x.close_price, 0) / period
    const today = rows[i].close_price
    const yesterday = rows[i - 1].close_price
    if (direction === 'break_below') {
      if (yesterday >= ma && today < ma) {
        hits.push({ symbol, trigger_date: rows[i].trade_date, details: { ma_period: period, ma: +ma.toFixed(2), close: today } })
      }
    } else {
      if (yesterday <= ma && today > ma) {
        hits.push({ symbol, trigger_date: rows[i].trade_date, details: { ma_period: period, ma: +ma.toFixed(2), close: today } })
      }
    }
  }
  return hits
}

function detectGapUp(symbol: string, rows: PriceRow[], p: any): Hit[] {
  const minGap = Number(p.min_gap_pct ?? 3)
  const hits: Hit[] = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const prev = rows[i - 1]
    if (!r.open_price || !prev.close_price) continue
    const gap = pctChange(r.open_price, prev.close_price)
    if (gap >= minGap) {
      hits.push({ symbol, trigger_date: r.trade_date, details: { gap_pct: +gap.toFixed(2) } })
    }
  }
  return hits
}

function detectForeignBuyStreak(symbol: string, rows: PriceRow[], p: any): Hit[] {
  // 近似版：連續 N 日收紅 + 量大於均量
  const minDays = Math.max(2, Math.min(30, Number(p.min_days ?? 5)))
  const minVolPct = Number(p.min_volume_pct ?? 0)  // 沒有外資量時退回 0
  const hits: Hit[] = []
  for (let i = minDays + 5; i < rows.length; i++) {
    let allUp = true
    for (let k = 0; k < minDays; k++) {
      const cur = rows[i - k]
      const prev = rows[i - k - 1]
      if (cur.close_price <= prev.close_price) { allUp = false; break }
    }
    if (!allUp) continue
    if (minVolPct > 0) {
      const vol5 = rows.slice(i - 5, i).reduce((s, x) => s + (x.volume ?? 0), 0) / 5
      if (!vol5 || (rows[i].volume ?? 0) / vol5 < (1 + minVolPct / 100)) continue
    }
    hits.push({ symbol, trigger_date: rows[i].trade_date, details: { streak_days: minDays } })
  }
  return hits
}

function detectKdGoldenCross(symbol: string, rows: PriceRow[], p: any): Hit[] {
  const period = Math.max(5, Math.min(30, Number(p.k_period ?? 9)))
  const oversold = Number(p.oversold_threshold ?? 30)
  if (rows.length < period + 3) return []
  const rsv: number[] = []
  for (let i = period - 1; i < rows.length; i++) {
    const window = rows.slice(i - period + 1, i + 1)
    const high = Math.max(...window.map(x => x.high_price ?? x.close_price))
    const low = Math.min(...window.map(x => x.low_price ?? x.close_price))
    const close = rows[i].close_price
    rsv.push(high === low ? 50 : ((close - low) / (high - low)) * 100)
  }
  const k: number[] = [50]
  const d: number[] = [50]
  for (let i = 0; i < rsv.length; i++) {
    k.push((2 / 3) * k[k.length - 1] + (1 / 3) * rsv[i])
    d.push((2 / 3) * d[d.length - 1] + (1 / 3) * k[k.length - 1])
  }
  const hits: Hit[] = []
  // k/d 對應的 row index = period - 1 + j（j=0..rsv.length-1），k[j+1] / d[j+1]
  for (let j = 1; j < rsv.length; j++) {
    const kPrev = k[j], dPrev = d[j], kNow = k[j + 1], dNow = d[j + 1]
    if (kPrev <= dPrev && kNow > dNow && kNow < oversold + 20 && kPrev < oversold + 5) {
      const rowIdx = period - 1 + j
      hits.push({ symbol, trigger_date: rows[rowIdx].trade_date, details: { k: +kNow.toFixed(1), d: +dNow.toFixed(1) } })
    }
  }
  return hits
}

function detectRevenueYoy(symbol: string, rows: PriceRow[], p: any): Hit[] {
  // fallback: 用月初/月底的累積漲幅當代理
  const minYoy = Number(p.min_yoy_pct ?? 30)
  const hits: Hit[] = []
  // 取每月最後一個交易日 vs 12 個月前最後一個交易日
  const byMonth = new Map<string, PriceRow>()
  for (const r of rows) {
    const ym = r.trade_date.slice(0, 7)
    byMonth.set(ym, r)
  }
  const months = Array.from(byMonth.keys()).sort()
  for (let i = 12; i < months.length; i++) {
    const cur = byMonth.get(months[i])!
    const prev = byMonth.get(months[i - 12])!
    if (!cur || !prev) continue
    const yoy = pctChange(cur.close_price, prev.close_price)
    if (yoy >= minYoy) {
      hits.push({ symbol, trigger_date: cur.trade_date, details: { yoy_proxy_pct: +yoy.toFixed(1) } })
    }
  }
  return hits
}

function detect(item: KnowledgeItem, bySym: Map<string, PriceRow[]>, paramsOverride?: any): Hit[] {
  const cond = paramsOverride ?? item.trigger_condition ?? {}
  const type = cond.type
  const result: Hit[] = []
  for (const [symbol, rows] of bySym) {
    if (rows.length < 30) continue
    let hits: Hit[] = []
    switch (type) {
      case 'foreign_buy_streak': hits = detectForeignBuyStreak(symbol, rows, cond); break
      case 'volume_price_surge': hits = detectVolumePriceSurge(symbol, rows, cond); break
      case 'ma_breakdown': hits = detectMaBreakdown(symbol, rows, cond); break
      case 'kd_golden_cross': hits = detectKdGoldenCross(symbol, rows, cond); break
      case 'gap_up': hits = detectGapUp(symbol, rows, cond); break
      case 'revenue_yoy': hits = detectRevenueYoy(symbol, rows, cond); break
      default: hits = []
    }
    result.push(...hits)
  }
  return result
}

// ---- 評估 hit 的後續走勢 ----
function evaluateHits(item: KnowledgeItem, hits: Hit[], bySym: Map<string, PriceRow[]>): {
  stats: BacktestStats
  evaluated: Array<{ hit: Hit; actual_change_pct: number; is_correct: boolean; horizon_days: number; expected_direction: string }>
} {
  const exp = item.expected_outcome ?? {}
  const horizon = Math.max(1, Math.min(60, Number(exp.horizon_days ?? 5)))
  const minMovePct = Number(exp.min_move_pct ?? 1)
  const direction = String(exp.direction ?? 'up')

  const evaluated: any[] = []
  const returns: number[] = []
  let win = 0, loss = 0
  let peak = 0, sum = 0, maxDd = 0

  for (const hit of hits) {
    const rows = bySym.get(hit.symbol) ?? []
    const idx = rows.findIndex(r => r.trade_date === hit.trigger_date)
    if (idx < 0 || idx + horizon >= rows.length) continue
    const entry = rows[idx].close_price
    const exit = rows[idx + horizon].close_price
    if (!entry || !exit) continue
    const change = pctChange(exit, entry)
    let correct = false
    if (direction === 'up') correct = change >= minMovePct
    else if (direction === 'down') correct = change <= -minMovePct
    else correct = Math.abs(change) >= minMovePct

    if (correct) win++; else loss++
    returns.push(change)
    sum += change
    if (sum > peak) peak = sum
    if (peak - sum > maxDd) maxDd = peak - sum
    evaluated.push({
      hit, actual_change_pct: +change.toFixed(2),
      is_correct: correct, horizon_days: horizon, expected_direction: direction,
    })
  }

  const total = win + loss
  const sortedR = [...returns].sort((a, b) => a - b)
  return {
    stats: {
      total_hits: total,
      win_count: win,
      loss_count: loss,
      win_rate: total > 0 ? +(win / total).toFixed(4) : null,
      avg_return_pct: total > 0 ? +(returns.reduce((s, x) => s + x, 0) / total).toFixed(2) : null,
      median_return_pct: total > 0 ? +(sortedR[Math.floor(sortedR.length / 2)]).toFixed(2) : null,
      max_drawdown: +maxDd.toFixed(2),
    },
    evaluated,
  }
}

// ---- 主入口 ----
async function loadPriceData(sb: any, dateStart?: string, dateEnd?: string): Promise<PriceRow[]> {
  let q = sb.from('daily_price_snapshots')
    .select('symbol,trade_date,open_price,high_price,low_price,close_price,volume')
    .order('trade_date', { ascending: true })
    .limit(500_000)
  if (dateStart) q = q.gte('trade_date', dateStart)
  if (dateEnd) q = q.lte('trade_date', dateEnd)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as PriceRow[]
}

async function backtestOne(sb: any, item: KnowledgeItem, bySym: Map<string, PriceRow[]>, runMode: string, paramsOverride?: any) {
  const params = paramsOverride ?? item.trigger_condition
  const hits = detect(item, bySym, params)
  const { stats, evaluated } = evaluateHits(item, hits, bySym)

  // 寫 run
  const { data: runData, error: runErr } = await sb
    .from('knowledge_backtest_runs')
    .insert({
      knowledge_item_id: item.id,
      run_mode: runMode,
      total_hits: stats.total_hits,
      win_count: stats.win_count,
      loss_count: stats.loss_count,
      win_rate: stats.win_rate,
      avg_return_pct: stats.avg_return_pct,
      median_return_pct: stats.median_return_pct,
      max_drawdown: stats.max_drawdown,
      parameters: params,
      details: { evaluated_count: evaluated.length },
      universe_size: bySym.size,
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (runErr) throw runErr
  const runId = runData.id

  // 寫 validations（hit 級別）— 控制最多 200 筆避免爆量
  const valRows = evaluated.slice(0, 200).map(e => ({
    knowledge_item_id: item.id,
    stock_code: e.hit.symbol,
    horizon_days: e.horizon_days,
    expected_direction: e.expected_direction,
    actual_change_pct: e.actual_change_pct,
    is_correct: e.is_correct,
    details: { ...e.hit.details, trigger_date: e.hit.trigger_date, run_id: runId },
  }))
  if (valRows.length > 0) {
    await sb.from('checkup_knowledge_validations').insert(valRows)
  }

  // 更新 knowledge item 統計（只在非 grid_search 時更新；grid_search 是試算）
  if (runMode !== 'grid_search') {
    await sb.from('checkup_knowledge_items').update({
      win_rate: stats.win_rate,
      sample_size: stats.total_hits,
      last_validated_at: new Date().toISOString(),
      backtest_run_at: new Date().toISOString(),
      backtest_stats: stats,
      universe_size: bySym.size,
    }).eq('id', item.id)
  }

  return { runId, stats }
}

// 為 6 種 trigger 各自定義網格
function buildGrid(triggerType: string, base: any): any[] {
  const grids: any[] = []
  if (triggerType === 'volume_price_surge') {
    for (const vr of [1.5, 2.0, 2.5, 3.0]) {
      for (const pc of [2, 3, 4, 5]) {
        grids.push({ ...base, type: 'volume_price_surge', min_volume_ratio: vr, min_price_change_pct: pc })
      }
    }
  } else if (triggerType === 'ma_breakdown') {
    for (const period of [5, 10, 20, 60]) {
      for (const dir of ['break_below', 'break_above']) {
        grids.push({ ...base, type: 'ma_breakdown', ma_period: period, direction: dir })
      }
    }
  } else if (triggerType === 'gap_up') {
    for (const g of [2, 3, 4, 5, 7]) {
      grids.push({ ...base, type: 'gap_up', min_gap_pct: g })
    }
  } else if (triggerType === 'foreign_buy_streak') {
    for (const days of [3, 5, 7, 10]) {
      for (const pct of [0, 20, 50]) {
        grids.push({ ...base, type: 'foreign_buy_streak', min_days: days, min_volume_pct: pct })
      }
    }
  } else if (triggerType === 'kd_golden_cross') {
    for (const period of [9, 14]) {
      for (const os of [20, 30, 40]) {
        grids.push({ ...base, type: 'kd_golden_cross', k_period: period, oversold_threshold: os })
      }
    }
  } else if (triggerType === 'revenue_yoy') {
    for (const yoy of [10, 20, 30, 50]) {
      grids.push({ ...base, type: 'revenue_yoy', min_yoy_pct: yoy })
    }
  }
  return grids
}

Deno.serve(withLogging('knowledge-backtest', async (req, log) => {
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

  try {
    const body = await req.json().catch(() => ({}))
    const mode: string = body.mode ?? 'single'
    const itemId: string | undefined = body.item_id
    const dateStart: string | undefined = body.date_start
    const dateEnd: string | undefined = body.date_end
    const promoteIfBetter: boolean = !!body.promote_if_better
    const minImprovementPct: number = Number(body.min_improvement_pct ?? 5)  // 至少改善 5% 才升級

    log.info('params', { mode, itemId, dateStart, dateEnd, promoteIfBetter })
    const sb = serviceClient()

    // 載入價格資料（一次性）
    const rows = await loadPriceData(sb, dateStart, dateEnd)
    if (rows.length < 100) {
      return errorResponse(`daily_price_snapshots 只有 ${rows.length} 筆，請先呼叫 backfill-daily-snapshots`, 400, {
        ok: false, error: 'INSUFFICIENT_DATA',
      })
    }
    const bySym = groupBySymbol(rows)

    // 取得目標 items
    let items: KnowledgeItem[] = []
    if (mode === 'full') {
      const { data, error } = await sb
        .from('checkup_knowledge_items')
        .select('id,item_id,trigger_condition,expected_outcome,confidence')
        .eq('is_active', true)
        .eq('backtestable', true)
      if (error) throw error
      items = (data ?? []) as KnowledgeItem[]
    } else {
      if (!itemId) return errorResponse('item_id required', 400, { ok: false })
      const { data, error } = await sb
        .from('checkup_knowledge_items')
        .select('id,item_id,trigger_condition,expected_outcome,confidence')
        .eq('id', itemId)
        .single()
      if (error) throw error
      items = [data as KnowledgeItem]
    }

    if (mode === 'grid_search') {
      const item = items[0]
      const triggerType = item.trigger_condition?.type
      const grid = buildGrid(triggerType, {})
      if (grid.length === 0) {
        return errorResponse(`No grid defined for trigger type: ${triggerType}`, 400, { ok: false })
      }

      // 為這個 grid_search 建一個 parent run
      const { data: parentRun, error: pErr } = await sb
        .from('knowledge_backtest_runs')
        .insert({
          knowledge_item_id: item.id,
          run_mode: 'grid_search',
          parameters: { grid_count: grid.length, trigger_type: triggerType },
          status: 'running',
          universe_size: bySym.size,
        }).select('id').single()
      if (pErr) throw pErr

      const results: any[] = []
      for (const params of grid) {
        const hits = detect(item, bySym, params)
        const { stats } = evaluateHits(item, hits, bySym)
        const wr = stats.win_rate ?? 0
        const ar = stats.avg_return_pct ?? 0
        // 綜合分數：win_rate + 平均報酬正規化（最少 30 樣本才算數）
        const score = stats.total_hits >= 30 ? wr * 0.6 + (Math.max(-10, Math.min(20, ar)) / 20) * 0.4 : 0
        results.push({ params, stats, score })
      }
      results.sort((a, b) => b.score - a.score)
      const best = results[0]

      // 寫入每格結果
      const gridRows = results.map((r, idx) => ({
        run_id: parentRun.id,
        knowledge_item_id: item.id,
        parameters: r.params,
        total_hits: r.stats.total_hits,
        win_rate: r.stats.win_rate,
        avg_return_pct: r.stats.avg_return_pct,
        score: +r.score.toFixed(4),
        is_best: idx === 0,
      }))
      await sb.from('knowledge_grid_search_results').insert(gridRows)
      await sb.from('knowledge_backtest_runs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          win_rate: best.stats.win_rate,
          avg_return_pct: best.stats.avg_return_pct,
          total_hits: best.stats.total_hits,
          win_count: best.stats.win_count,
          loss_count: best.stats.loss_count,
          details: { best_params: best.params },
        }).eq('id', parentRun.id)

      // 自動升級
      let promoted: { new_id: string; old_id: string } | null = null
      if (promoteIfBetter && best.stats.total_hits >= 30) {
        // 取舊版 win_rate
        const { data: oldItem } = await sb
          .from('checkup_knowledge_items')
          .select('win_rate')
          .eq('id', item.id).single()
        const oldWr = Number(oldItem?.win_rate ?? 0)
        const newWr = Number(best.stats.win_rate ?? 0)
        if (newWr > oldWr + minImprovementPct / 100) {
          const { data: rpc, error: rpcErr } = await sb.rpc('archive_and_promote_knowledge', {
            _old_id: item.id,
            _new_trigger: best.params,
            _new_confidence: Math.min(0.95, 0.5 + newWr * 0.5),
            _note: `grid_search winner: wr ${(newWr * 100).toFixed(1)}% > old ${(oldWr * 100).toFixed(1)}%`,
          })
          if (!rpcErr) promoted = { new_id: rpc, old_id: item.id }
        }
      }

      return jsonResponse({
        ok: true,
        mode: 'grid_search',
        item_id: item.id,
        run_id: parentRun.id,
        grid_size: grid.length,
        best: { parameters: best.params, stats: best.stats, score: best.score },
        top_5: results.slice(0, 5).map(r => ({ parameters: r.params, win_rate: r.stats.win_rate, total_hits: r.stats.total_hits, score: +r.score.toFixed(3) })),
        promoted,
      })
    }

    // single / full
    const out: any[] = []
    const startedAt = Date.now()

    // 載入自動規則（僅 full 模式套用）
    let autoRules: any = null
    if (mode === 'full') {
      const { data: rulesRow } = await sb.from('knowledge_auto_rules')
        .select('*').limit(1).maybeSingle()
      autoRules = rulesRow?.enabled ? rulesRow : null
    }

    const autoActions: any[] = []

    for (const item of items) {
      if (Date.now() - startedAt > 45_000) break
      // 抓更新前的勝率/樣本數，回應裡帶 delta 方便前端顯示「舊→新」
      let prev: { win_rate: number | null; sample_size: number | null } = { win_rate: null, sample_size: null }
      try {
        const { data: prevRow } = await sb
          .from('checkup_knowledge_items')
          .select('win_rate,sample_size')
          .eq('id', item.id).single()
        if (prevRow) prev = { win_rate: prevRow.win_rate, sample_size: prevRow.sample_size }
      } catch (_) { /* ignore */ }

      try {
        const { runId, stats } = await backtestOne(sb, item, bySym, mode === 'full' ? 'cron_weekly' : 'full')
        out.push({
          item_id: item.id, run_id: runId, stats,
          prev_win_rate: prev.win_rate, prev_sample_size: prev.sample_size,
        })

        // 套用自動規則
        if (autoRules && stats.total_hits >= autoRules.min_sample_size && stats.win_rate != null) {
          const wr = Number(stats.win_rate)
          let action: string | null = null
          let reason: string | null = null

          if (wr < Number(autoRules.archive_below_win_rate)) {
            // 歸檔停用
            await sb.from('checkup_knowledge_items').update({
              is_active: false, archived_at: new Date().toISOString(),
            }).eq('id', item.id)
            action = 'archived'
            reason = `勝率 ${(wr * 100).toFixed(1)}% < 門檻 ${(autoRules.archive_below_win_rate * 100).toFixed(0)}%（n=${stats.total_hits}）`
          } else if (wr > Number(autoRules.promote_above_win_rate)) {
            // 提升信心度（不換 trigger，只調 confidence）
            const newConf = Math.min(0.95, 0.5 + wr * 0.5)
            await sb.from('checkup_knowledge_items').update({
              confidence: newConf,
            }).eq('id', item.id)
            action = 'promoted_confidence'
            reason = `勝率 ${(wr * 100).toFixed(1)}% > 門檻 ${(autoRules.promote_above_win_rate * 100).toFixed(0)}%，信心度提升至 ${(newConf * 100).toFixed(0)}%`
          } else if (wr < Number(autoRules.auto_grid_search_below)) {
            // 自動跑網格搜尋並可能升版
            try {
              const triggerType = item.trigger_condition?.type
              const grid = buildGrid(triggerType, {})
              if (grid.length > 0) {
                const gridResults: any[] = []
                for (const params of grid) {
                  const hits = detect(item, bySym, params)
                  const { stats: gs } = evaluateHits(item, hits, bySym)
                  const score = gs.total_hits >= 30 ? (gs.win_rate ?? 0) : 0
                  gridResults.push({ params, stats: gs, score })
                }
                gridResults.sort((a, b) => b.score - a.score)
                const best = gridResults[0]
                const minImpr = Number(autoRules.promote_min_improvement_pct ?? 5) / 100
                if (best && best.stats.total_hits >= autoRules.min_sample_size &&
                    Number(best.stats.win_rate ?? 0) > wr + minImpr) {
                  await sb.rpc('archive_and_promote_knowledge', {
                    _old_id: item.id,
                    _new_trigger: best.params,
                    _new_confidence: Math.min(0.95, 0.5 + Number(best.stats.win_rate ?? 0) * 0.5),
                    _note: `auto_rule grid winner: wr ${(Number(best.stats.win_rate ?? 0) * 100).toFixed(1)}% > old ${(wr * 100).toFixed(1)}%`,
                  })
                  action = 'auto_grid_promoted'
                  reason = `自動網格找到更佳組合：勝率 ${(Number(best.stats.win_rate ?? 0) * 100).toFixed(1)}% > 原 ${(wr * 100).toFixed(1)}%`
                } else {
                  action = 'auto_grid_no_winner'
                  reason = `自動網格未找到顯著改善（最佳 ${best?.stats?.win_rate != null ? (Number(best.stats.win_rate) * 100).toFixed(1) + '%' : 'N/A'}）`
                }
              }
            } catch (gridErr) {
              action = 'auto_grid_failed'
              reason = String(gridErr)
            }
          }

          if (action) {
            await sb.from('knowledge_backtest_runs').update({
              auto_action: action, auto_action_reason: reason,
            }).eq('id', runId)
            // 寫 audit_logs
            await sb.from('audit_logs').insert({
              actor_id: null,
              action: 'knowledge.auto_rule.' + action,
              target_type: 'checkup_knowledge_items',
              target_id: item.id,
              detail: { reason, win_rate: wr, sample_size: stats.total_hits, run_id: runId },
            })
            autoActions.push({ item_id: item.id, action, reason })
          }
        }
      } catch (e) {
        // 把失敗也寫進歷史，方便後台追蹤
        const errMsg = String(e?.message ?? e)
        try {
          await sb.from('knowledge_backtest_runs').insert({
            knowledge_item_id: item.id,
            run_mode: mode === 'full' ? 'cron_weekly' : 'full',
            parameters: item.trigger_condition ?? {},
            status: 'failed',
            error_message: errMsg,
            universe_size: bySym.size,
            completed_at: new Date().toISOString(),
          })
        } catch (_) { /* ignore log failure */ }
        out.push({ item_id: item.id, error: errMsg })
      }
    }

    // 觸發 LINE 通知（full 模式才發；single 模式靜默以免吵）
    if (mode === 'full') {
      try {
        await sb.functions.invoke('notify-backtest-result', {
          body: { hours: 2, trigger: body.trigger ?? 'cron' },
        })
      } catch (notifyErr) {
        log.error('notify_invoke_failed', { err: String(notifyErr) })
      }
    }

    return jsonResponse({
      ok: true,
      mode,
      universe_size: bySym.size,
      processed: out.length,
      partial: out.length < items.length,
      auto_rules_enabled: !!autoRules,
      auto_actions: autoActions,
      results: out,
    })

  } catch (err) {
    log.error('handler_threw', { err: String(err) })
    return errorResponse(String(err), 500, { ok: false })
  }
}))
