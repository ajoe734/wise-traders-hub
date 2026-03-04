import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Wraps the public landing page.
 * If a user is already authenticated, redirect to their role-based home.
 * Otherwise show the public page (children).
 */
export function SmartHomeRedirect({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, isLoading, hasRole } = useAuth();

  // Still loading session — show nothing (flash-free)
  if (isLoading) return null;

  if (isAuthenticated && user) {
    if (hasRole('company_admin')) {
      return <Navigate to="/company" replace />;
    }
    if (user.expertSlug) {
      return <Navigate to={`/admin/${user.expertSlug}`} replace />;
    }
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
}
