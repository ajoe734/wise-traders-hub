/**
 * Trade log operations — edit, delete (with holdings rollback), CSV export, group.
 *
 * 反向套用一筆已寫入的成交：
 *   買進 → 從現有 holdings 扣 qty；若 cost 已被加權平均稀釋，反推回舊 cost
 *   賣出 → 補回 qty（cost 維持當前值，因為賣出本來就不會動 cost）
 */

import { normalizeHoldings, applyTradeEntryToHoldings } from './holdings.js'
import { normalizeStockCode } from './stockIdentity.ts'

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * 交易權威欄位：只有這些欄位可以由 replay 覆蓋 prior holdings。
 * 其餘（price / priceSource / priceUpdatedAt / yesterday / change / changePct /
 * targetPrice / alert / sector…）都是非交易衍生的行情與 enrichment，
 * 從空 rows replay 時無法重建，必須沿用刪除／編輯前的同代碼持倉，
 * 否則使用者刪一筆無關交易就會整批現價被重設為成本（來源顯示「未同步」）。
 */
const TRADE_AUTHORITATIVE_KEYS = ['qty', 'cost', 'totalCost', 'fee']

/**
 * 以 normalized code 把 replay 結果合併回刪除前的持倉。
 * - replay 沒有的代碼 → 已被刪除，不得殘留
 * - prior 沒有的代碼 → 直接採用 replay row（新標的）
 */
export function mergeReplayWithPriorHoldings(replayRows, priorHoldings, quotes = null) {
  const prior = Array.isArray(priorHoldings) ? priorHoldings : []
  if (!prior.length) return normalizeHoldings(replayRows, quotes)

  const priorByCode = new Map()
  for (const row of prior) {
    const code = normalizeStockCode(row?.code)
    if (code && !priorByCode.has(code)) priorByCode.set(code, row)
  }

  const merged = (Array.isArray(replayRows) ? replayRows : []).map((row) => {
    const base = priorByCode.get(normalizeStockCode(row?.code))
    if (!base) return row
    const out = {
      ...base,
      code: row.code,
      name: base.name || row.name,
      type: row.type || base.type,
      // 只要可由正式交易紀錄 replay，這筆就是真實使用者持倉。
      // 避免代碼碰巧位於 DEMO_SEED_CODES（例如 2308）時被 auto-save 清除。
      userOrigin: true,
      tradeLogTouched: true,
    }
    for (const key of TRADE_AUTHORITATIVE_KEYS) out[key] = row[key]
    return out
  })

  return normalizeHoldings(merged, quotes)
}

/**
 * Hydration reconciliation：雲端 holdings 可能因舊版競態少於權威 trade log。
 * 只補入「logs 可 replay、holdings 卻缺少」的部位；既有 holdings 的交易欄位與
 * 行情 enrichment 全部原樣保留，避免載入時改動已存在部位的 qty / cost。
 */
export function reconcileHoldingsWithTradeLog(holdings, tradeLog, quotes = null) {
  const current = normalizeHoldings(Array.isArray(holdings) ? holdings : [], quotes)
  const replayed = replayTradeLog(tradeLog, quotes)
  if (!replayed.length) return current

  const existingCodes = new Set(current.map((row) => normalizeStockCode(row?.code)).filter(Boolean))
  const missing = replayed
    .filter((row) => !existingCodes.has(normalizeStockCode(row?.code)))
    .map((row) => ({ ...row, userOrigin: true, tradeLogTouched: true }))

  return missing.length ? normalizeHoldings([...current, ...missing], quotes) : current
}

/**
 * Replay tradeLog from empty holdings to recompute deterministic state.
 * tradeLog 預期由近到遠（畫面排序）；replay 內部會自行依時間正序套用。
 * priorHoldings：replay 前的持倉，用來保留非交易衍生的行情／enrichment。
 */
export function replayTradeLog(tradeLog = [], quotes = null, priorHoldings = null) {
  const sorted = [...(Array.isArray(tradeLog) ? tradeLog : [])].sort((a, b) => {
    const da = `${a.date || ''} ${a.time || ''}`
    const db = `${b.date || ''} ${b.time || ''}`
    if (da !== db) return da < db ? -1 : 1
    return String(a.id || '').localeCompare(String(b.id || ''))
  })
  let rows = []
  for (const t of sorted) {
    rows = applyTradeEntryToHoldings(rows, t, quotes)
  }
  const replayed = normalizeHoldings(rows, quotes)
  return priorHoldings ? mergeReplayWithPriorHoldings(replayed, priorHoldings, quotes) : replayed
}

/**
 * Recompute holdings after deleting a single trade by id, by replaying remaining log.
 * 比起反向回滾更安全：均價與全賣後再買等情境都正確。
 */
export function recomputeHoldingsAfterDelete(tradeLog, deletedId, quotes = null, priorHoldings = null) {
  const next = (Array.isArray(tradeLog) ? tradeLog : []).filter((r) => r.id !== deletedId)
  return replayTradeLog(next, quotes, priorHoldings)
}

export function reverseTradeOnHoldings(rows, trade, quotes = null) {
  if (!trade || !trade.code) return normalizeHoldings(rows, quotes)
  const arr = [...(Array.isArray(rows) ? rows : [])]
  const idx = arr.findIndex((h) => h.code === trade.code)
  const qty = num(trade.qty)
  const price = num(trade.price)

  if (trade.action === '買進') {
    if (idx < 0) return normalizeHoldings(arr, quotes)
    const h = arr[idx]
    const curQty = num(h.qty)
    const newQty = Math.max(0, curQty - qty)
    if (newQty === 0) {
      arr.splice(idx, 1)
    } else {
      // Reverse weighted-average: prevCost = (curCost*curQty - price*qty) / newQty
      const curCost = num(h.cost)
      const reversedCost = (curCost * curQty - price * qty) / newQty
      arr[idx] = {
        ...h,
        qty: newQty,
        cost: Math.max(0, Math.round(reversedCost * 100) / 100),
      }
    }
    return normalizeHoldings(arr, quotes)
  }

  // 賣出：補回 qty
  if (idx >= 0) {
    const h = arr[idx]
    arr[idx] = { ...h, qty: num(h.qty) + qty }
  } else {
    arr.push({
      code: trade.code,
      name: trade.name,
      qty,
      price,
      cost: price,
      type: '股票',
    })
  }
  return normalizeHoldings(arr, quotes)
}

export function tradeLogToCSV(rows = []) {
  const header = ['日期', '時間', '動作', '代碼', '名稱', '股數', '價格', '金額', '備忘1', '備忘2', '備忘3']
  const escape = (v) => {
    const s = String(v ?? '')
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [header.join(',')]
  for (const r of Array.isArray(rows) ? rows : []) {
    const amt = num(r.qty) * num(r.price)
    const qa = Array.isArray(r.qa) ? r.qa : []
    lines.push(
      [
        r.date,
        r.time,
        r.action,
        r.code,
        r.name,
        r.qty,
        r.price,
        amt,
        qa[0]?.a || '',
        qa[1]?.a || '',
        qa[2]?.a || '',
      ]
        .map(escape)
        .join(',')
    )
  }
  return '\uFEFF' + lines.join('\n')
}

export function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function groupByDate(rows = []) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = r.date || '未知日期'
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(r)
  }
  // Sort within day: latest time first
  for (const arr of map.values()) {
    arr.sort((a, b) => `${b.time || ''}`.localeCompare(`${a.time || ''}`) || String(b.id).localeCompare(String(a.id)))
  }
  // Return as sorted array of [date, rows] descending
  return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1))
}

export function summarizeDay(rows = []) {
  let buy = 0
  let sell = 0
  let net = 0
  for (const r of rows) {
    const amt = num(r.qty) * num(r.price)
    if (r.action === '買進') {
      buy += 1
      net -= amt
    } else {
      sell += 1
      net += amt
    }
  }
  return { buy, sell, net }
}
