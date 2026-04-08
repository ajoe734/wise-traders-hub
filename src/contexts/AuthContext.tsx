import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User as SupabaseUser } from '@supabase/supabase-js';

type AppRole = 'company_admin' | 'analyst';

interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
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
    supabase.from('profiles').select('display_name, expert_slug, avatar_url').eq('user_id', userId).single(),
    supabase.from('user_roles').select('role').eq('user_id', userId),
  ]);

  return {
    id: userId,
    email,
    displayName: profileRes.data?.display_name || null,
    avatarUrl: profileRes.data?.avatar_url || null,
    roles: (rolesRes.data || []).map((r: any) => r.role as AppRole),
    expertSlug: profileRes.data?.expert_slug || null,
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
      // Map Supabase English errors to Chinese
      const errorMap: Record<string, string> = {
        'Invalid login credentials': '帳號或密碼錯誤，請重新輸入',
        'Email not confirmed': '請先到信箱點擊驗證連結，再嘗試登入',
        'Invalid email or password': '帳號或密碼錯誤，請重新輸入',
        'Too many requests': '嘗試次數過多，請稍後再試',
        'User not found': '帳號或密碼錯誤，請重新輸入',
      };
      const zhError = errorMap[error.message] || '登入失敗，請稍後再試';
      return { success: false, error: zhError };
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
      const regErrorMap: Record<string, string> = {
        'User already registered': '此電子郵件已註冊，請直接登入',
        'Password should be at least 6 characters': '密碼至少需要 6 個字元',
        'Unable to validate email address: invalid format': '電子郵件格式不正確',
      };
      return { success: false, error: regErrorMap[error.message] || '註冊失敗，請稍後再試' };
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
