import { createContext, useContext, useState, useEffect, useMemo } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { DEMO_HOLDINGS, DEMO_ANALYSIS, DEMO_BRAIN, DEMO_EVENTS } from '../data/demoData.js'

const CheckupModeContext = createContext(null)

/**
 * Checkup mode: 'demo' | 'line_only' | 'full'
 *
 * demo      → not authenticated, show fake data, upload disabled
 * line_only → authenticated via LINE, free tier (1 upload/day, passive refresh)
 * full      → authenticated with paid subscription, all features enabled
 */
export function CheckupModeProvider({ children }) {
  const [mode, setMode] = useState('demo') // demo | line_only | full
  const [lineProfile, setLineProfile] = useState(null) // { lineUserId, displayName }
  const [supabaseUser, setSupabaseUser] = useState(null)
  const [uploadCountToday, setUploadCountToday] = useState(0)
  const [isLineFriend, setIsLineFriend] = useState(false) // whether user added OA as friend
  const [isReady, setIsReady] = useState(false)

  // Check auth state on mount
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        setSupabaseUser(session.user)

        // Check if user has line_user_id
        const { data: profile } = await supabase
          .from('profiles')
          .select('line_user_id, display_name')
          .eq('user_id', session.user.id)
          .maybeSingle()

        if (profile?.line_user_id) {
          setLineProfile({
            lineUserId: profile.line_user_id,
            displayName: profile.display_name || 'LINE 用戶',
          })
          setMode('line_only')
        } else {
          // Authenticated but no LINE binding → treat as full user (normal login)
          setMode('full')
        }

        // Check today's upload count
        const today = new Date().toISOString().slice(0, 10)
        const countKey = `checkup-upload-count-${session.user.id}-${today}`
        const { data: countRow } = await supabase
          .from('checkup_storage')
          .select('data')
          .eq('key', countKey)
          .maybeSingle()
        setUploadCountToday(countRow?.data?.count || 0)
      } else {
        setMode('demo')
      }
      setIsReady(true)
    }

    checkAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setSupabaseUser(session.user)
      } else {
        setSupabaseUser(null)
        setLineProfile(null)
        setMode('demo')
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Handle LINE login callback params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const lineUid = params.get('line_uid')
    const lineName = params.get('line_name')
    const lineSession = params.get('line_session')
    const lineFriend = params.get('line_friend')

    if (lineUid && lineSession) {
      setLineProfile({
        lineUserId: lineUid,
        displayName: decodeURIComponent(lineName || 'LINE 用戶'),
      })
      setIsLineFriend(lineFriend === '1')
      setMode('line_only')

      // Clean URL
      const cleanUrl = window.location.pathname
      window.history.replaceState({}, '', cleanUrl)
    }
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
    // LINE login trigger
    startLineLogin: () => {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const callbackUrl = `${supabaseUrl}/functions/v1/line-login-callback`
      const returnTo = window.location.pathname
      const authorizeUrl = `${supabaseUrl}/functions/v1/line-login-authorize?redirect_uri=${encodeURIComponent(callbackUrl)}&return_to=${encodeURIComponent(returnTo)}`
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
