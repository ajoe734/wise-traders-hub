import { createContext, useContext, useEffect, useMemo, useState, ReactNode, useCallback } from 'react';

const STORAGE_KEY = 'view-as-session-v1';

export interface ViewAsSession {
  adminUserId: string;
  targetUserId: string;
  targetEmail: string | null;
  targetDisplayName: string | null;
  targetRoles?: string[];
  targetActiveExpertSubs?: number;
  targetActiveCheckupSubs?: number;
  expiresAt: string; // ISO
}

interface ViewAsContextValue {
  session: ViewAsSession | null;
  isActive: boolean;
  setSession: (s: ViewAsSession | null) => void;
  exit: () => void;
  msRemaining: number;
}

const Ctx = createContext<ViewAsContextValue | undefined>(undefined);

function readStored(): ViewAsSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ViewAsSession;
    if (new Date(parsed.expiresAt).getTime() < Date.now()) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function ViewAsProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<ViewAsSession | null>(() =>
    typeof window === 'undefined' ? null : readStored(),
  );
  const [now, setNow] = useState(Date.now());

  // Tick every 5s to update remaining time display
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [session]);

  // Auto-expire
  useEffect(() => {
    if (!session) return;
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      setSessionState(null);
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, [now, session]);

  const setSession = useCallback((s: ViewAsSession | null) => {
    setSessionState(s);
    if (typeof window === 'undefined') return;
    if (s) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  const exit = useCallback(() => {
    setSession(null);
    // If opened as popup, close the tab — admin's original tab remains intact.
    // Otherwise navigate back to the company admin home so the admin stops
    // seeing member-scoped UI.
    try {
      if (typeof window !== 'undefined' && window.opener) {
        window.close();
        return;
      }
    } catch { /* noop */ }
    if (typeof window !== 'undefined') {
      window.location.href = '/company';
    }
  }, [setSession]);

  const value = useMemo<ViewAsContextValue>(() => ({
    session,
    isActive: !!session,
    setSession,
    exit,
    msRemaining: session ? Math.max(0, new Date(session.expiresAt).getTime() - now) : 0,
  }), [session, setSession, exit, now]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useViewAs(): ViewAsContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useViewAs must be used inside ViewAsProvider');
  return v;
}

/**
 * Returns the user ID to use for member-scoped data queries.
 * - When an admin has an active view-as session, returns the target member's ID.
 * - Otherwise returns the supplied auth user ID (typically `useAuth().user?.id`).
 */
export function useEffectiveUserId(authUserId: string | null | undefined): string | null {
  const { session } = useViewAs();
  return session?.targetUserId ?? authUserId ?? null;
}
