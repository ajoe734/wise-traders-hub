import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { queryClient, purgePersistedQueryCache } from '@/lib/queryClient';
import type { AuthError, User as SupabaseUser } from '@supabase/supabase-js';
import { gtmPush } from '@/lib/analytics/gtm';
import { track } from '@/lib/analytics/events';

type AppRole = 'company_admin' | 'analyst';

const AUTH_ERROR_BY_CODE: Record<string, string> = {
  invalid_credentials: '帳號或密碼錯誤，請重新輸入',
  email_not_confirmed: '請先到信箱點擊驗證連結，再嘗試登入',
  user_not_found: '帳號或密碼錯誤，請重新輸入',
  user_banned: '此帳號已被停用，請聯繫客服',
  too_many_requests: '嘗試次數過多，請稍後再試',
  over_request_rate_limit: '請求頻率過高，請稍後再試',
  over_email_send_rate_limit: '信件寄送頻率過高，請稍後再試',
  user_already_exists: '此電子郵件已註冊，請直接登入',
  email_exists: '此電子郵件已註冊，請直接登入',
  weak_password: '密碼太弱或曾在外洩資料中出現，請換一組更複雜的密碼',
  signup_disabled: '目前不開放註冊，請聯繫客服',
  email_address_invalid: '電子郵件格式不正確',
  validation_failed: '輸入資料不正確，請檢查後再試',
  captcha_failed: '人機驗證失敗，請重新嘗試',
  session_not_found: '登入狀態已失效，請重新登入',
  otp_expired: '驗證碼已過期，請重新取得',
  provider_disabled: '此登入方式未開放',
  email_provider_disabled: '此登入方式未開放',
  bad_code_verifier: '驗證流程失敗，請重新嘗試',
};

const AUTH_ERROR_BY_MESSAGE: Record<string, string> = {
  'Invalid login credentials': '帳號或密碼錯誤，請重新輸入',
  'Invalid email or password': '帳號或密碼錯誤，請重新輸入',
  'User not found': '帳號或密碼錯誤，請重新輸入',
  'Email not confirmed': '請先到信箱點擊驗證連結，再嘗試登入',
  'Too many requests': '嘗試次數過多，請稍後再試',
  'Too many requests. Please try later.': '嘗試次數過多，請稍後再試',
  'Email rate limit exceeded': '信件寄送頻率過高，請稍後再試',
  'User is banned': '此帳號已被停用，請聯繫客服',
  'User banned': '此帳號已被停用，請聯繫客服',
  'Email link is invalid or has expired': '連結已失效，請重新操作',
  'User already registered': '此電子郵件已註冊，請直接登入',
  'A user with this email address has already been registered': '此電子郵件已註冊，請直接登入',
  'Password is known to be weak and easy to guess, please choose a different one.': '密碼太弱或曾在外洩資料中出現，請換一組更複雜的密碼',
  'Unable to validate email address: invalid format': '電子郵件格式不正確',
  'Signups not allowed for this instance': '目前不開放註冊，請聯繫客服',
  'Signups not allowed for otp': '目前不開放註冊，請聯繫客服',
  'Anonymous sign-ins are disabled': '不支援匿名登入',
  'Signup requires a valid password': '請輸入有效密碼',
  'Only an email address or phone number should be provided on signup': '註冊時請只提供電子郵件',
  'Database error saving new user': '系統暫時無法建立帳號，請稍後再試',
  'Database error granting user': '系統暫時無法完成登入，請稍後再試',
  'Invalid Refresh Token: Already Used': '登入狀態已失效，請重新登入',
  'Invalid Refresh Token: Not Found': '登入狀態已失效，請重新登入',
  'Auth session missing!': '尚未登入，請先登入',
  'New password should be different from the old password.': '新密碼不可與舊密碼相同',
};

function mapAuthError(error: AuthError | { message: string; code?: string } | null | undefined, context: 'login' | 'register' | 'reset' | 'update'): string {
  const fallbackMap = {
    login: '登入失敗，請稍後再試',
    register: '註冊失敗，請稍後再試',
    reset: '寄送重設信失敗，請稍後再試',
    update: '更新密碼失敗，請稍後再試',
  };
  const fallback = fallbackMap[context];
  if (!error) return fallback;

  const code = (error as { code?: string }).code;
  if (code && AUTH_ERROR_BY_CODE[code]) return AUTH_ERROR_BY_CODE[code];

  const msg = error.message || '';
  if (AUTH_ERROR_BY_MESSAGE[msg]) return AUTH_ERROR_BY_MESSAGE[msg];

  const atLeast = msg.match(/^Password should be at least (\d+) characters/i);
  if (atLeast) return `密碼至少需要 ${atLeast[1]} 個字元`;

  if (/^Password should contain/i.test(msg)) return '密碼不符合安全要求，請包含大小寫字母、數字或特殊符號';
  if (/^Weak password/i.test(msg)) return '密碼太弱或曾在外洩資料中出現，請換一組更複雜的密碼';
  if (/^For security purposes, you can only request this/i.test(msg)) return '請稍候片刻後再試（安全性限制）';
  if (/^Email address .* is invalid/i.test(msg)) return '電子郵件格式不正確';
  if (/rate limit/i.test(msg)) return '請求頻率過高，請稍後再試';

  console.error(`[Auth:${context}] unmapped error`, { code, message: msg, error });
  return fallback;
}

interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  isTester: boolean;
  roles: AppRole[];
  expertSlug: string | null;
  isLineUser: boolean;
  lineUserId: string | null;
}

interface AuthStateValue {
  user: AuthUser | null;
  supabaseUser: SupabaseUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthActionsValue {
  hasRole: (role: AppRole) => boolean;
  refreshProfile: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (email: string, password: string, name: string) => Promise<{ success: boolean; error?: string }>;
  requestPasswordReset: (email: string) => Promise<{ success: boolean; error?: string }>;
  updatePassword: (password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

type AuthContextType = AuthStateValue & AuthActionsValue;

// Split contexts: state changes on auth events (login/logout/token refresh) and
// re-renders all subscribers; actions are stable refs so action-only consumers
// (forms, buttons) never re-render on token refresh. `useAuth()` keeps the
// merged shape for backward compatibility.
const AuthStateContext = createContext<AuthStateValue | undefined>(undefined);
const AuthActionsContext = createContext<AuthActionsValue | undefined>(undefined);
AuthStateContext.displayName = 'AuthStateContext';
AuthActionsContext.displayName = 'AuthActionsContext';

async function fetchUserProfile(userId: string, email: string): Promise<AuthUser & { mergedInto?: string | null }> {
  const [profileRes, rolesRes] = await Promise.all([
    supabase.from('profiles').select('display_name, expert_slug, avatar_url, line_user_id, is_tester, merged_into_user_id').eq('user_id', userId).single(),
    supabase.from('user_roles').select('role').eq('user_id', userId),
  ]);

  const lineUserId = profileRes.data?.line_user_id || null;

  return {
    id: userId,
    email,
    displayName: profileRes.data?.display_name || null,
    avatarUrl: profileRes.data?.avatar_url || null,
    isTester: profileRes.data?.is_tester ?? false,
    roles: (rolesRes.data || []).map((r: any) => r.role as AppRole),
    expertSlug: profileRes.data?.expert_slug || null,
    isLineUser: !!lineUserId,
    lineUserId,
    mergedInto: (profileRes.data as any)?.merged_into_user_id || null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Track which user ID we're currently loading to avoid stale updates
  const loadingUserRef = React.useRef<string | null>(null);
  // In-flight promise dedupe: if the same user load is already running,
  // subsequent auth events (INITIAL_SESSION / SIGNED_IN / USER_UPDATED that
  // can fire within the ~800ms profile fetch window) reuse this promise
  // instead of firing duplicate (profiles + user_roles) request pairs.
  const inFlightRef = React.useRef<Promise<void> | null>(null);

  const clearAuth = useCallback(() => {
    loadingUserRef.current = null;
    inFlightRef.current = null;
    queryClient.clear();
    purgePersistedQueryCache();
    setSupabaseUser(null);
    setUser(null);
  }, []);

  const loadProfile = useCallback(async (sbUser: SupabaseUser, forceReload = false): Promise<void> => {
    const userId = sbUser.id;

    // Same user already in-flight or loaded → reuse, only update token ref.
    if (!forceReload && loadingUserRef.current === userId) {
      setSupabaseUser(sbUser);
      if (inFlightRef.current) return inFlightRef.current;
      return;
    }

    // Different user — clear stale state
    if (loadingUserRef.current && loadingUserRef.current !== userId) {
      queryClient.clear();
      setUser(null);
    }

    loadingUserRef.current = userId;
    setSupabaseUser(sbUser);
    setIsLoading(true);

    const promise = (async () => {
      try {
        const profile = await fetchUserProfile(userId, sbUser.email || '');
        if ((profile as any).mergedInto) {
          // This account has been merged as a secondary. Force sign-out with a clear message.
          console.warn('[Auth] merged secondary account detected → forcing sign-out', { userId, mergedInto: (profile as any).mergedInto });
          try {
            const { toast } = await import('sonner');
            toast.error('此帳號已合併至主帳號，請改用主帳號登入', { duration: 8000 });
          } catch { /* noop */ }
          await supabase.auth.signOut();
          clearAuth();
          return;
        }
        if (loadingUserRef.current === userId) {
          setUser(profile);
        }
      } catch (e) {
        console.error('Failed to load user profile:', e);
      } finally {
        if (loadingUserRef.current === userId) {
          setIsLoading(false);
          inFlightRef.current = null;
        }
      }
    })();

    inFlightRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    // Listen for auth state changes FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        clearAuth();
        setIsLoading(false);
        return;
      }

      if (session?.user) {
        const isSameUser = loadingUserRef.current === session.user.id;
        const isTokenRefresh = event === 'TOKEN_REFRESHED';

        // For token refresh of same user, just update the supabase user ref
        if (isSameUser && isTokenRefresh) {
          setSupabaseUser(session.user);
          return;
        }

        // For INITIAL_SESSION or SIGNED_IN, load profile (skip if already loaded)
        setTimeout(() => loadProfile(session.user), 0);
      }
    });

    // Then check existing session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        await loadProfile(session.user);
      } else {
        setIsLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Refs let action callbacks read latest state without re-creating identity.
  // This keeps the AuthActionsContext value stable across token refreshes, so
  // action-only consumers (forms, buttons) no longer re-render every refresh.
  const userRef = React.useRef(user);
  const supabaseUserRef = React.useRef(supabaseUser);
  React.useEffect(() => { userRef.current = user; }, [user]);
  React.useEffect(() => { supabaseUserRef.current = supabaseUser; }, [supabaseUser]);

  const hasRole = useCallback((role: AppRole) => user?.roles.includes(role) ?? false, [user]);

  const refreshProfile = useCallback(async () => {
    const sb = supabaseUserRef.current;
    if (!sb) return;
    await loadProfile(sb, true);
  }, [loadProfile]);

  const login = useCallback(async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    clearAuth();
    setIsLoading(true);
    track('auth_login_submit', { method: 'email' });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setIsLoading(false);
      const reason = (error as { code?: string }).code || error.message || 'unknown';
      track('auth_login_failure', { method: 'email', reason });
      return { success: false, error: mapAuthError(error, 'login') };
    }
    gtmPush('Login', { method: 'email' });
    track('auth_login_success', { method: 'email' });
    return { success: true };
  }, [clearAuth]);

  const register = useCallback(async (email: string, password: string, name: string): Promise<{ success: boolean; error?: string }> => {
    track('auth_signup_submit', { method: 'email' });
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) {
      const reason = (error as { code?: string }).code || error.message || 'unknown';
      track('auth_signup_failure', { method: 'email', reason });
      return { success: false, error: mapAuthError(error, 'register') };
    }
    gtmPush('SignUp', { method: 'email' });
    track('auth_signup_success', { method: 'email' });
    return { success: true };
  }, []);

  const requestPasswordReset = useCallback(async (email: string): Promise<{ success: boolean; error?: string }> => {
    const trimmed = email.trim();
    if (/@line\.local$/i.test(trimmed)) {
      return { success: false, error: '此帳號為 LINE 登入帳號，請改用「使用 LINE 快速登入」' };
    }
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    if (error) {
      return { success: false, error: mapAuthError(error, 'reset') };
    }
    return { success: true };
  }, []);

  const updatePassword = useCallback(async (password: string): Promise<{ success: boolean; error?: string }> => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      return { success: false, error: mapAuthError(error, 'update') };
    }
    return { success: true };
  }, []);

  const logout = useCallback(async () => {
    clearAuth();
    setIsLoading(true);
    await supabase.auth.signOut();
    setIsLoading(false);
  }, [clearAuth]);

  const isAuthenticated = !!user && !isLoading;

  const stateValue = useMemo<AuthStateValue>(
    () => ({ user, supabaseUser, isLoading, isAuthenticated }),
    [user, supabaseUser, isLoading, isAuthenticated],
  );

  // Actions value identity is stable for the provider lifetime — all members
  // are useCallback-wrapped with no state deps (they read via refs).
  const actionsValue = useMemo<AuthActionsValue>(
    () => ({ hasRole, refreshProfile, login, register, requestPasswordReset, updatePassword, logout }),
    [hasRole, refreshProfile, login, register, requestPasswordReset, updatePassword, logout],
  );

  return (
    <AuthActionsContext.Provider value={actionsValue}>
      <AuthStateContext.Provider value={stateValue}>
        {children}
      </AuthStateContext.Provider>
    </AuthActionsContext.Provider>
  );
}

export function useAuthState(): AuthStateValue {
  const ctx = useContext(AuthStateContext);
  if (ctx === undefined) throw new Error('useAuthState must be used within an AuthProvider');
  return ctx;
}

export function useAuthActions(): AuthActionsValue {
  const ctx = useContext(AuthActionsContext);
  if (ctx === undefined) throw new Error('useAuthActions must be used within an AuthProvider');
  return ctx;
}

/**
 * Backward-compatible combined hook. Prefer `useAuthState` or `useAuthActions`
 * in new code to avoid unnecessary re-renders on token refresh.
 */
export function useAuth(): AuthContextType {
  const state = useAuthState();
  const actions = useAuthActions();
  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}

