import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
  requiredRole?: 'company_admin' | 'analyst';
  subscriberOnly?: boolean;
}

export function ProtectedRoute({ children, requiredRole, subscriberOnly }: ProtectedRouteProps) {
  const { user, isAuthenticated, isLoading, hasRole } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth/login" state={{ from: location }} replace />;
  }

  if (requiredRole && !hasRole(requiredRole)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">權限不足</h1>
          <p className="text-muted-foreground">您沒有存取此頁面的權限</p>
        </div>
      </div>
    );
  }

  // subscriberOnly: kept as a flag (means "requires login") but no longer
  // redirects admins/analysts away — they may legitimately want to view
  // subscriber pages. Default landing redirects still happen via SmartHomeRedirect.

  return <>{children}</>;
}
