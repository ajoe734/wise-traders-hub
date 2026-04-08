import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Wraps the public landing page.
 * Role-based users (company_admin, analyst) are still redirected to their dashboard.
 * Regular users (including LINE login) can always see the public landing page.
 */
export function SmartHomeRedirect({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, isLoading, hasRole } = useAuth();

  // Still loading session — show nothing (flash-free)
  if (isLoading) return null;

  if (isAuthenticated && user) {
    // Only redirect role-based users (admins / analysts) to their dashboards
    if (hasRole('company_admin')) {
      return <Navigate to="/company" replace />;
    }
    if (user.expertSlug) {
      return <Navigate to={`/admin/${user.expertSlug}`} replace />;
    }
    // Regular users (including LINE login) stay on the landing page
  }

  return <>{children}</>;
}
