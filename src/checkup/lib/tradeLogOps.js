/**
 * Trade log operations — edit, delete (with holdings rollback), CSV export, group.
 *
 * 反向套用一筆已寫入的成交：
 *   買進 → 從現有 holdings 扣 qty；若 cost 已被加權平均稀釋，反推回舊 cost
 *   賣出 → 補回 qty（cost 維持當前值，因為賣出本來就不會動 cost）
 */

import { normalizeHoldings, applyTradeEntryToHoldings } from './holdings.js'

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Replay tradeLog from empty holdings to recompute deterministic state.
 * tradeLog 預期由近到遠（畫面排序）；replay 內部會自行依時間正序套用。
 */
export function replayTradeLog(tradeLog = [], quotes = null) {
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
  return normalizeHoldings(rows, quotes)
}

/**
 * Recompute holdings after deleting a single trade by id, by replaying remaining log.
 * 比起反向回滾更安全：均價與全賣後再買等情境都正確。
 */
export function recomputeHoldingsAfterDelete(tradeLog, deletedId, quotes = null) {
  const next = (Array.isArray(tradeLog) ? tradeLog : []).filter((r) => r.id !== deletedId)
  return replayTradeLog(next, quotes)
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
