import { useEffect, useState, useCallback, useRef } from 'react'
import { getCheckupGateway } from '../lib/gateway'

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
    const { data, error } = await getCheckupGateway().db
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
      const uid = await getCheckupGateway().auth.getUserId()
      if (!uid) {
        userIdRef.current = null
        setOverrides({})
        return
      }
      userIdRef.current = uid
      const map = await fetchOverrides(uid, force)
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
    const offAuth = getCheckupGateway().auth.onAuthStateChange((newUid) => {
      if (!newUid) {
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

    // C15 (audit 2026-07)：跨裝置 realtime。
    //   同一使用者在另一裝置 / edge function（AI 分類）寫入 holding_meta_overrides
    //   時，主動 invalidate cache + reload，不必等 60s TTL 過期。
    //   channel filter 已鎖 user_id，RLS 也只放行本 user，雙保險。
    //   channel 名稱含 uid 避免 hot-reload / 多 hook 實例重複訂閱衝突。
    let offRealtime = null
    let cancelled = false
    ;(async () => {
      const gw = getCheckupGateway()
      const uid = await gw.auth.getUserId()
      if (cancelled || !uid) return
      offRealtime = gw.realtime.subscribe(
        {
          name: `hmo-${uid}`,
          table: 'holding_meta_overrides',
          filter: `user_id=eq.${uid}`,
        },
        () => {
          CACHE.delete(uid)
          reload(true)
        },
      )
    })()

    return () => {
      cancelled = true
      SUBSCRIBERS.delete(onChange)
      offAuth?.()
      offRealtime?.()
    }
  }, [reload])

  const upsert = useCallback(async (code, patch) => {
    const uid = await getCheckupGateway().auth.getUserId()
    if (!uid) throw new Error('must sign in')
    const row = {
      user_id: uid,
      code: String(code),
      source: 'user_report',
      updated_at: new Date().toISOString(),
      ...patch,
    }
    const { error } = await getCheckupGateway().db
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
