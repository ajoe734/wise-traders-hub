import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { DEMO_HOLDINGS, DEMO_ANALYSIS, DEMO_BRAIN, DEMO_EVENTS } from '../data/demoData.js'

const CheckupModeContext = createContext(null)

/**
 * Mode (legacy, kept for compatibility):
 *   'demo'      → not authenticated
 *   'line_only' → LINE user without friend (kept for the OA-friend nudge)
 *   'full'      → authenticated (any tier ≥ free)
 *
 * Tier (new, for paywall logic):
 *   'guest' | 'free' | 'basic' | 'pro'
 *
 * Quota (from check_checkup_quota RPC):
 *   { tier, period: 'week'|'month', limit, used, remaining, resets_at }
 */
export function CheckupModeProvider({ children }) {
  const [mode, setMode] = useState('demo')
  const [tier, setTier] = useState('guest')
  const [quota, setQuota] = useState(null)
  const [lineProfile, setLineProfile] = useState(null)
  const [supabaseUser, setSupabaseUser] = useState(null)
  const [isLineFriend, setIsLineFriend] = useState(false)
  const [isReady, setIsReady] = useState(false)

  const fetchQuota = useCallback(async (userId) => {
    if (!userId) {
      setQuota(null)
      setTier('guest')
      return null
    }
    try {
      const { data, error } = await supabase.rpc('check_checkup_quota', { _user_id: userId })
      if (error) {
        console.error('[checkup] check_checkup_quota failed', error)
        return null
      }
      if (data) {
        setQuota(data)
        setTier(data.tier || 'free')
        return data
      }
    } catch (err) {
      console.error('[checkup] quota fetch error', err)
    }
    return null
  }, [])

  useEffect(() => {
    const determineMode = async (user) => {
      if (!user) {
        setMode('demo')
        setTier('guest')
        setQuota(null)
        setLineProfile(null)
        setIsLineFriend(false)
        setSupabaseUser(null)
        setIsReady(true)
        return
      }

      setSupabaseUser(user)

      const { data: profile } = await supabase
        .from('profiles')
        .select('line_user_id, display_name, avatar_url, is_line_friend, is_tester')
        .eq('user_id', user.id)
        .maybeSingle()

      if (profile?.line_user_id) {
        setLineProfile({
          lineUserId: profile.line_user_id,
          displayName: profile.display_name || 'LINE 用戶',
          avatarUrl: profile.avatar_url || null,
        })
        setIsLineFriend(profile.is_line_friend === true)
        // If LINE user has no friend yet, surface the nudge; otherwise authenticated
        setMode(profile.is_line_friend === true ? 'full' : 'line_only')
      } else {
        setLineProfile(null)
        setIsLineFriend(false)
        setMode('full')
      }

      // Pull tier + quota from the database
      await fetchQuota(user.id)
      setIsReady(true)
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      determineMode(session?.user || null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (_event === 'SIGNED_OUT') {
        determineMode(null)
      } else if (session?.user) {
        determineMode(session.user)
      }
    })

    return () => subscription.unsubscribe()
  }, [fetchQuota])

  const isDemo = mode === 'demo'
  // Authenticated users (any tier) can upload — quota only restricts AI calls, not data entry
  const canUpload = mode !== 'demo'
  // Manual price refresh is a paid-only feature
  const canRefreshManually = tier === 'basic' || tier === 'pro'
  const needsAddFriend = mode === 'line_only' && !isLineFriend

  // Convenience: AI quota status
  const remainingQuota = quota?.remaining ?? 0
  const hasQuota = remainingQuota > 0
  const periodLabel = quota?.period === 'week' ? '本週' : '本月'
  const tierLabel = tier === 'pro' ? 'Pro'
    : tier === 'basic' ? 'Basic'
    : tier === 'free' ? '免費版'
    : '訪客'

  const refreshQuota = useCallback(async () => {
    if (!supabaseUser?.id) return null
    return await fetchQuota(supabaseUser.id)
  }, [supabaseUser?.id, fetchQuota])

  // After a backend AI call, sync local quota state from the response payload
  const applyQuotaFromResponse = useCallback((payload) => {
    if (payload?.quota) {
      setQuota(payload.quota)
      setTier(payload.quota.tier || tier)
    } else {
      // Best-effort refresh
      refreshQuota()
    }
  }, [refreshQuota, tier])

  const demoData = useMemo(() => {
    if (!isDemo) return null
    return {
      holdings: DEMO_HOLDINGS,
      analysis: DEMO_ANALYSIS,
      brain: DEMO_BRAIN,
      events: DEMO_EVENTS,
    }
  }, [isDemo])

  const value = {
    mode,
    tier,
    tierLabel,
    quota,
    remainingQuota,
    hasQuota,
    periodLabel,
    isDemo,
    isReady,
    canUpload,
    canRefreshManually,
    // Legacy compat — kept so existing components keep working
    hasReachedDailyLimit: !hasQuota && tier !== 'guest',
    needsAddFriend,
    isLineFriend,
    lineProfile,
    supabaseUser,
    demoData,
    refreshQuota,
    applyQuotaFromResponse,
    // Legacy no-op for callers still using this name
    /**
     * @deprecated 配額由 edge function 原子扣點。請改用 applyQuotaFromResponse(data) 同步 UI。
     * 保留為 no-op（refreshQuota）避免舊 caller 炸掉。
     */
    incrementUploadCount: async () => {
      await refreshQuota()
    },
    startLineLogin: () => {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const callbackUrl = `${supabaseUrl}/functions/v1/line-login-callback`
      const returnTo = `${window.location.pathname}${window.location.search}`
      try {
        sessionStorage.setItem('line_login_return_to', returnTo)
      } catch {}
      const appOrigin = window.location.origin
      const authorizeUrl = `${supabaseUrl}/functions/v1/line-login-authorize?redirect_uri=${encodeURIComponent(callbackUrl)}&return_to=${encodeURIComponent(returnTo)}&app_origin=${encodeURIComponent(appOrigin)}`
      console.log('[LINE-LOGIN] Checkup page → LINE authorize', { returnTo, appOrigin, authorizeUrl })
      window.location.href = authorizeUrl
    },
  }

  return (
    <CheckupModeContext.Provider value={value}>
      {children}
    </CheckupModeContext.Provider>
  )
}

export function useCheckupMode() {
  const ctx = useContext(CheckupModeContext)
  if (!ctx) throw new Error('useCheckupMode must be used within CheckupModeProvider')
  return ctx
}
