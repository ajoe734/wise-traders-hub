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
      .select('code, industry, industries, themes, revenue_mix, strategy, leader, position, source, updated_at')
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
      if (!user) {
        userIdRef.current = null
        setOverrides({})
        return
      }
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

    // C14 (audit 2026-07)：跨帳號隔離。
    //   同一 tab logout→login 為另一個 email/line 帳號時，若不清 CACHE
    //   會殘留前一個 user 的 overrides map（雖然 key 不同，SUBSCRIBERS 觸發時
    //   仍會 setOverrides 舊 map，直到下次 upsert）。
    //   SIGNED_OUT → 清 CACHE 與本地 state；
    //   SIGNED_IN / TOKEN_REFRESHED 且 user.id 變動 → 強制 reload(true)。
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      const newUid = session?.user?.id || null
      if (event === 'SIGNED_OUT' || !newUid) {
        CACHE.clear()
        userIdRef.current = null
        setOverrides({})
        notifySubscribers()
        return
      }
      if (newUid !== userIdRef.current) {
        CACHE.clear()
        userIdRef.current = newUid
        reload(true)
      }
    })

    return () => {
      SUBSCRIBERS.delete(onChange)
      authSub?.subscription?.unsubscribe()
    }
  }, [reload])

  const upsert = useCallback(async (code, patch) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('must sign in')
    const row = {
      user_id: user.id,
      code: String(code),
      source: 'user_report',
      updated_at: new Date().toISOString(),
      ...patch,
    }
    const { error } = await supabase
      .from('holding_meta_overrides')
      .upsert(row, { onConflict: 'user_id,code' })
    if (error) throw error
    invalidateMetaOverridesCache()
    await reload(true)
  }, [reload])

  return { overrides, loading, reload: () => reload(true), upsert }
}

/** Merge override over base STOCK_META entry. Override fields win when non-empty. */
export function mergeMeta(base, override) {
  if (!override) return base || null
  const out = { ...(base || {}) }
  for (const k of ['industry', 'strategy', 'leader', 'position']) {
    if (override[k]) out[k] = override[k]
  }
  if (Array.isArray(override.industries) && override.industries.length) out.industries = override.industries
  if (Array.isArray(override.themes) && override.themes.length) out.themes = override.themes
  if (override.revenue_mix) out.revenueMix = override.revenue_mix
  return out
}
