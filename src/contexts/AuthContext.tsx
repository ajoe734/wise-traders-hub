import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { queryClient } from '@/lib/queryClient';
import type { AuthError, User as SupabaseUser } from '@supabase/supabase-js';

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

interface AuthContextType {
  user: AuthUser | null;
  supabaseUser: SupabaseUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasRole: (role: AppRole) => boolean;
  refreshProfile: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (email: string, password: string, name: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
AuthContext.displayName = 'AuthContext';

async function fetchUserProfile(userId: string, email: string): Promise<AuthUser> {
  const [profileRes, rolesRes] = await Promise.all([
    supabase.from('profiles').select('display_name, expert_slug, avatar_url, line_user_id, is_tester').eq('user_id', userId).single(),
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
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Track which user ID we're currently loading to avoid stale updates
  const loadingUserRef = React.useRef<string | null>(null);

  const clearAuth = useCallback(() => {
    loadingUserRef.current = null;
    queryClient.clear();
    setSupabaseUser(null);
    setUser(null);
  }, []);

  const loadProfile = useCallback(async (sbUser: SupabaseUser, forceReload = false) => {
    const userId = sbUser.id;

    // If same user is already loaded, just update supabaseUser (token refresh) and skip
    if (!forceReload && loadingUserRef.current === userId && user) {
      setSupabaseUser(sbUser);
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

    try {
      const profile = await fetchUserProfile(userId, sbUser.email || '');
      // Only apply if this is still the user we're loading
      if (loadingUserRef.current === userId) {
        setUser(profile);
      }
    } catch (e) {
      console.error('Failed to load user profile:', e);
    } finally {
      if (loadingUserRef.current === userId) {
        setIsLoading(false);
      }
    }
  }, [user]);

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

  const hasRole = (role: AppRole) => user?.roles.includes(role) ?? false;

  const refreshProfile = useCallback(async () => {
    if (!supabaseUser) return;
    await loadProfile(supabaseUser, true);
  }, [supabaseUser, loadProfile]);

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    // Clear state before login to prevent stale data
    clearAuth();
    setIsLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setIsLoading(false);
      return { success: false, error: mapAuthError(error, 'login') };
    }
    // Profile loading happens via onAuthStateChange — force reload for new login
    return { success: true };
  };

  const register = async (email: string, password: string, name: string): Promise<{ success: boolean; error?: string }> => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) {
      return { success: false, error: mapAuthError(error, 'register') };
    }
    return { success: true };
  };

  const logout = async () => {
    clearAuth();
    setIsLoading(true);
    await supabase.auth.signOut();
    setIsLoading(false);
  };

  const isAuthenticated = !!user && !isLoading;

  return (
    <AuthContext.Provider value={{ user, supabaseUser, isLoading, isAuthenticated, hasRole, refreshProfile, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
