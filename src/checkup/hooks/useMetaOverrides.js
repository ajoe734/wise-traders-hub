import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'

/**
 * Loads holding_meta_overrides for the current user and exposes a Map keyed by stock code.
 * UI 抽屜應以 override 優先於 STOCK_META。
 */
export function useMetaOverrides() {
  const [overrides, setOverrides] = useState({})
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setOverrides({}); return }
      const { data, error } = await supabase
        .from('holding_meta_overrides')
        .select('code, industry, strategy, leader, position, source, updated_at')
        .eq('user_id', user.id)
      if (error) throw error
      const map = {}
      for (const row of data || []) map[row.code] = row
      setOverrides(map)
    } catch (e) {
      console.error('useMetaOverrides load failed:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  return { overrides, loading, reload }
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
