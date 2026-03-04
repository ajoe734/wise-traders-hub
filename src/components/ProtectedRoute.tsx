import { ReactNode } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
  requiredRole?: 'company_admin' | 'analyst';
  /** When true, the :expertSlug param must match the logged-in user's expertSlug (company_admin bypasses) */
  requireSlugOwnership?: boolean;
}

export function ProtectedRoute({ children, requiredRole, requireSlugOwnership }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, hasRole, user } = useAuth();
  const location = useLocation();
  const { expertSlug } = useParams<{ expertSlug?: string }>();

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

  // Company admins bypass role + slug checks (they can view any analyst backend)
  if (hasRole('company_admin')) {
    return <>{children}</>;
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

  // Slug ownership: analyst can only access their own backend
  if (requireSlugOwnership && expertSlug && user?.expertSlug !== expertSlug) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">權限不足</h1>
          <p className="text-muted-foreground">您無法存取其他分析師的後台</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
