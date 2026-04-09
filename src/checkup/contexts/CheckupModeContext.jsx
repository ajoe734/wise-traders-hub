import { createContext, useContext, useState, useEffect, useMemo } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { DEMO_HOLDINGS, DEMO_ANALYSIS, DEMO_BRAIN, DEMO_EVENTS } from '../data/demoData.js'

const CheckupModeContext = createContext(null)

/**
 * Checkup mode: 'demo' | 'line_only' | 'full'
 *
 * demo      → not authenticated, show fake data, upload disabled
 * line_only → authenticated via LINE (has line_user_id in profile), free tier
 * full      → authenticated with paid subscription or email account, all features enabled
 */
export function CheckupModeProvider({ children }) {
  const [mode, setMode] = useState('demo') // demo | line_only | full
  const [lineProfile, setLineProfile] = useState(null) // { lineUserId, displayName }
  const [supabaseUser, setSupabaseUser] = useState(null)
  const [uploadCountToday, setUploadCountToday] = useState(0)
  const [isLineFriend, setIsLineFriend] = useState(false) // whether user added OA as friend
  const [isReady, setIsReady] = useState(false)

  // Determine mode from Supabase auth session + profile
  useEffect(() => {
    const determineMode = async (user) => {
      if (!user) {
        setMode('demo')
        setLineProfile(null)
        setIsLineFriend(false)
        setSupabaseUser(null)
        setIsReady(true)
        return
      }

      setSupabaseUser(user)

      // Fetch profile to check if this is a LINE user
      const { data: profile } = await supabase
        .from('profiles')
        .select('line_user_id, display_name, avatar_url, is_line_friend')
        .eq('user_id', user.id)
        .maybeSingle()

      if (profile?.line_user_id) {
        // LINE user
        setLineProfile({
          lineUserId: profile.line_user_id,
          displayName: profile.display_name || 'LINE 用戶',
          avatarUrl: profile.avatar_url || null,
        })
        setIsLineFriend(profile.is_line_friend === true)
        setMode('line_only')
      } else {
        // Email/regular user → full access
        setLineProfile(null)
        setIsLineFriend(false)
        setMode('full')
      }

      // Load upload count for today
      const today = new Date().toISOString().slice(0, 10)
      const countKey = `checkup-upload-count-${user.id}-${today}`
      const { data: countRow } = await supabase
        .from('checkup_storage')
        .select('data')
        .eq('key', countKey)
        .maybeSingle()
      setUploadCountToday(countRow?.data?.count || 0)

      setIsReady(true)
    }

    // Check existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      determineMode(session?.user || null)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (_event === 'SIGNED_OUT') {
        determineMode(null)
      } else if (session?.user) {
        determineMode(session.user)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const isDemo = mode === 'demo'
  const canUpload = mode !== 'demo' && (mode === 'full' || isLineFriend)
  const hasReachedDailyLimit = mode === 'line_only' && uploadCountToday >= 1
  const canRefreshManually = mode === 'full' // line_only users get passive refresh only
  const needsAddFriend = mode === 'line_only' && !isLineFriend

  const incrementUploadCount = async () => {
    if (!supabaseUser) return
    const today = new Date().toISOString().slice(0, 10)
    const countKey = `checkup-upload-count-${supabaseUser.id}-${today}`
    const newCount = uploadCountToday + 1
    setUploadCountToday(newCount)
    await supabase.from('checkup_storage').upsert({
      key: countKey,
      data: { count: newCount },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
  }

  // Demo data for unauthenticated users
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
    isDemo,
    isReady,
    canUpload,
    canRefreshManually,
    hasReachedDailyLimit,
    needsAddFriend,
    isLineFriend,
    lineProfile,
    supabaseUser,
    demoData,
    incrementUploadCount,
    // LINE login trigger — now goes through the unified Supabase auth flow
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
