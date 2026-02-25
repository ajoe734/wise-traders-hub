import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User as SupabaseUser } from '@supabase/supabase-js';

type AppRole = 'company_admin' | 'analyst';

interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  roles: AppRole[];
  expertSlug: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  supabaseUser: SupabaseUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasRole: (role: AppRole) => boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (email: string, password: string, name: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
AuthContext.displayName = 'AuthContext';

async function fetchUserProfile(userId: string, email: string): Promise<AuthUser> {
  const [profileRes, rolesRes] = await Promise.all([
    supabase.from('profiles').select('display_name, expert_slug').eq('user_id', userId).single(),
    supabase.from('user_roles').select('role').eq('user_id', userId),
  ]);

  return {
    id: userId,
    email,
    displayName: profileRes.data?.display_name || null,
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

  const loadProfile = useCallback(async (sbUser: SupabaseUser) => {
    const userId = sbUser.id;
    loadingUserRef.current = userId;
    setSupabaseUser(sbUser);
    // Clear previous user immediately to prevent stale redirects
    setUser(null);
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
        // If the user ID changed (account switch), clear immediately
        if (supabaseUser?.id && supabaseUser.id !== session.user.id) {
          clearAuth();
        }
        // Defer profile loading to avoid Supabase client deadlock
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

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    // Clear state before login to prevent stale data
    clearAuth();
    setIsLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setIsLoading(false);
      return { success: false, error: error.message };
    }
    // Profile loading happens via onAuthStateChange
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
    if (error) return { success: false, error: error.message };
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
    <AuthContext.Provider value={{ user, supabaseUser, isLoading, isAuthenticated, hasRole, login, register, logout }}>
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
