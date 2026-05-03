import { useMemo, useState } from 'react'
import { groupByDate } from '../lib/tradeLogOps.js'

/**
 * Step 4: 把 LogPanel 的搜尋／篩選／日期區間／全期摘要狀態抽離出來。
 * 不負責任何 mutation，只回傳純資料 + setter，方便 LogPanel 專注於 view layer。
 */
export function useLogPanelFilters(tradeLog = []) {
  const [q, setQ] = useState('')
  const [actionFilter, setActionFilter] = useState('all') // all | buy | sell
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return (Array.isArray(tradeLog) ? tradeLog : []).filter((r) => {
      if (actionFilter === 'buy' && r.action !== '買進') return false
      if (actionFilter === 'sell' && r.action !== '賣出') return false
      if (kw) {
        const hay = `${r.code || ''} ${r.name || ''}`.toLowerCase()
        if (!hay.includes(kw)) return false
      }
      if (dateFrom && (r.date || '') < dateFrom) return false
      if (dateTo && (r.date || '') > dateTo) return false
      return true
    })
  }, [tradeLog, q, actionFilter, dateFrom, dateTo])

  const grouped = useMemo(() => groupByDate(filtered), [filtered])

  const totals = useMemo(() => {
    let buy = 0, sell = 0, net = 0
    for (const r of filtered) {
      const amt = Number(r.qty || 0) * Number(r.price || 0)
      if (r.action === '買進') { buy += 1; net -= amt }
      else { sell += 1; net += amt }
    }
    return { buy, sell, net }
  }, [filtered])

  const reset = () => {
    setQ('')
    setActionFilter('all')
    setDateFrom('')
    setDateTo('')
  }

  return {
    q, setQ,
    actionFilter, setActionFilter,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    filtered, grouped, totals,
    reset,
  }
}
