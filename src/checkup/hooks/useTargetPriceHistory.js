import { useEffect, useState, useCallback, useRef } from 'react'
import { getCheckupGateway } from '../lib/gateway'

/**
 * Per-(userId, code) cache for target_price_history.
 * - TTL 90s, SWR background refresh on focus
 */
const CACHE = new Map() // key=`${userId}:${code}` -> { rows, fetchedAt, inflight }
const TTL_MS = 90_000

function makeKey(userId, code) { return `${userId}:${code}` }

async function fetchHistory(userId, code, limit, force = false) {
  const key = makeKey(userId, code)
  const cached = CACHE.get(key)
  const fresh = cached && Date.now() - cached.fetchedAt < TTL_MS
  if (cached?.inflight) return cached.inflight
  if (fresh && !force) return cached.rows

  const inflight = (async () => {
    const { data, error } = await getCheckupGateway().db
      .from('target_price_history')
      .select('id, firm, target, prev_target, report_date, change_type, source, batch_id, created_at, detail')
      .eq('user_id', userId)
      .eq('code', code)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    const rows = data || []
    CACHE.set(key, { rows, fetchedAt: Date.now(), inflight: null })
    return rows
  })()
  CACHE.set(key, { ...(cached || { rows: [], fetchedAt: 0 }), inflight })
  return inflight
}

export function invalidateTargetPriceHistoryCache(code) {
  if (!code) { CACHE.clear(); return }
  for (const k of [...CACHE.keys()]) if (k.endsWith(':' + code)) CACHE.delete(k)
}

export function useTargetPriceHistory(code, { limit = 30, enabled = true } = {}) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const mounted = useRef(true)

  const reload = useCallback(async (force = false) => {
    if (!code || !enabled) { setRows([]); return }
    const userId = await getCheckupGateway().auth.getUserId()
    if (!userId) { setRows([]); return }
    // Show cached immediately if present
    const key = makeKey(userId, code)
    const cached = CACHE.get(key)
    if (cached?.rows) setRows(cached.rows)
    if (!force && cached && Date.now() - cached.fetchedAt < TTL_MS) return
    setLoading(true)
    try {
      const data = await fetchHistory(userId, code, limit, force)
      if (mounted.current) setRows(data)
    } catch (e) {
      console.error('useTargetPriceHistory load failed:', e)
      if (mounted.current) setRows([])
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [code, limit, enabled])

  useEffect(() => {
    mounted.current = true
    reload()
    return () => { mounted.current = false }
  }, [reload])

  return { rows, loading, reload: () => reload(true) }
}

export async function recordTargetPriceBatch(code, entries, source = 'refresh-reports') {
  try {
    const userId = await getCheckupGateway().auth.getUserId()
    if (!userId || !code || !Array.isArray(entries) || entries.length === 0) return { inserted: 0, batchId: null }

    const { data: latest } = await getCheckupGateway().db
      .from('target_price_history')
      .select('firm, target, created_at')
      .eq('user_id', userId)
      .eq('code', code)
      .order('created_at', { ascending: false })
      .limit(200)

    const latestByFirm = new Map()
    for (const row of latest || []) {
      if (!latestByFirm.has(row.firm)) latestByFirm.set(row.firm, Number(row.target))
    }

    const batchId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : null
    const rows = []
    for (const e of entries) {
      const target = Number(e?.target)
      if (!Number.isFinite(target) || target <= 0) continue
      const firm = String(e?.firm || '').trim()
      const prev = latestByFirm.get(firm)
      let changeType = 'new'
      if (Number.isFinite(prev)) {
        if (prev === target) continue
        changeType = 'updated'
      }
      rows.push({
        user_id: userId,
        code,
        firm,
        target,
        prev_target: Number.isFinite(prev) ? prev : null,
        report_date: e?.date ? String(e.date) : null,
        change_type: changeType,
        source,
        batch_id: batchId,
      })
    }
    if (rows.length === 0) return { inserted: 0, batchId }
    const { error } = await getCheckupGateway().db.from('target_price_history').insert(rows)
    if (error) throw error
    invalidateTargetPriceHistoryCache(code)

    // 依使用者偏好寫入 in-app 通知
    try {
      const { data: prefs } = await getCheckupGateway().db
        .from('notification_preferences')
        .select('target_price_new, target_price_updated')
        .eq('user_id', userId)
        .maybeSingle()
      const wantNew = prefs?.target_price_new !== false
      const wantUpd = prefs?.target_price_updated !== false
      const newCount = rows.filter(r => r.change_type === 'new').length
      const updCount = rows.filter(r => r.change_type === 'updated').length
      const shouldNotify = (wantNew && newCount > 0) || (wantUpd && updCount > 0)
      if (shouldNotify) {
        await getCheckupGateway().db.from('notifications').insert({
          user_id: userId,
          title: `${code} 目標價更新`,
          body: `新增 ${newCount} 筆 / 修改 ${updCount} 筆（來源：${source}）`,
          type: 'info',
          link: '/holding-checkup',
        })
      }
    } catch (notifyErr) {
      // Best-effort, 不阻斷主流程
      console.warn('notify target price change failed', notifyErr)
    }

    return { inserted: rows.length, batchId }
  } catch (e) {
    console.error('recordTargetPriceBatch failed:', e)
    return { inserted: 0, batchId: null, error: e?.message }
  }
}
