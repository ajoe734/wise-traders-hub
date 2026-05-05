import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/integrations/supabase/client'

/**
 * Module-level cache for holding_meta_overrides keyed by user_id.
 * - TTL: 60s (數據變動低頻，AI 寫入後會主動 invalidate)
 * - 多個 hook 實例共享同一份資料 + 訂閱機制，避免抽屜重覆查詢
 */
const CACHE = new Map() // user_id -> { data, fetchedAt, inflight }
const SUBSCRIBERS = new Set() // () => void
const TTL_MS = 60_000

function notifySubscribers() {
  for (const fn of SUBSCRIBERS) {
    try { fn() } catch {}
  }
}

async function fetchOverrides(userId, force = false) {
  const cached = CACHE.get(userId)
  const fresh = cached && Date.now() - cached.fetchedAt < TTL_MS
  if (cached?.inflight) return cached.inflight
  if (fresh && !force) return cached.data

  const inflight = (async () => {
    const { data, error } = await supabase
      .from('holding_meta_overrides')
      .select('code, industry, strategy, leader, position, source, updated_at')
      .eq('user_id', userId)
    if (error) throw error
    const map = {}
    for (const row of data || []) map[row.code] = row
    CACHE.set(userId, { data: map, fetchedAt: Date.now(), inflight: null })
    notifySubscribers()
    return map
  })()
  CACHE.set(userId, { ...(cached || { data: {}, fetchedAt: 0 }), inflight })
  return inflight
}

export function invalidateMetaOverridesCache() {
  CACHE.clear()
  notifySubscribers()
}

export function useMetaOverrides() {
  const [overrides, setOverrides] = useState({})
  const [loading, setLoading] = useState(false)
  const userIdRef = useRef(null)

  const reload = useCallback(async (force = false) => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setOverrides({}); return }
      userIdRef.current = user.id
      const map = await fetchOverrides(user.id, force)
      setOverrides(map)
    } catch (e) {
      console.error('useMetaOverrides load failed:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
    // SWR-style: subscribe to cache changes
    const onChange = () => {
      const uid = userIdRef.current
      if (!uid) return
      const c = CACHE.get(uid)
      if (c?.data) setOverrides(c.data)
    }
    SUBSCRIBERS.add(onChange)
    return () => { SUBSCRIBERS.delete(onChange) }
  }, [reload])

  return { overrides, loading, reload: () => reload(true) }
}

/** Merge override over base STOCK_META entry. Override fields win when non-empty. */
export function mergeMeta(base, override) {
  if (!override) return base || null
  const out = { ...(base || {}) }
  for (const k of ['industry', 'strategy', 'leader', 'position']) {
    if (override[k]) out[k] = override[k]
  }
  return out
}
