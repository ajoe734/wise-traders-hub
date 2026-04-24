import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '@/components/ProtectedRoute';

// Mock useAuth — controlled per-test via a mutable holder
const authMock: {
  user: any;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasRole: (role: string) => boolean;
} = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
  hasRole: () => false,
};

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authMock,
}));

function renderWithRoutes(initial: string, requiredRole?: 'company_admin' | 'analyst', subscriberOnly?: boolean) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route
          path="/protected"
          element={
            <ProtectedRoute requiredRole={requiredRole} subscriberOnly={subscriberOnly}>
              <div>Protected Content</div>
            </ProtectedRoute>
          }
        />
        <Route path="/auth/login" element={<div>Login Page</div>} />
        <Route path="/company" element={<div>Company Dashboard</div>} />
        <Route path="/admin/:slug" element={<div>Admin Dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    authMock.user = null;
    authMock.isAuthenticated = false;
    authMock.isLoading = false;
    authMock.hasRole = () => false;
  });

  it('shows loading spinner while auth state is loading', () => {
    authMock.isLoading = true;
    const { container } = renderWithRoutes('/protected');
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('redirects unauthenticated users to /auth/login', () => {
    renderWithRoutes('/protected');
    expect(screen.getByText('Login Page')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('renders children when authenticated and no role required', () => {
    authMock.isAuthenticated = true;
    authMock.user = { id: 'u1' };
    renderWithRoutes('/protected');
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('shows "permission denied" when user lacks required role', () => {
    authMock.isAuthenticated = true;
    authMock.user = { id: 'u1' };
    authMock.hasRole = () => false;
    renderWithRoutes('/protected', 'company_admin');
    expect(screen.getByText('權限不足')).toBeInTheDocument();
  });

  it('renders children when user has the required role', () => {
    authMock.isAuthenticated = true;
    authMock.user = { id: 'u1' };
    authMock.hasRole = (role: string) => role === 'analyst';
    renderWithRoutes('/protected', 'analyst');
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('redirects company_admin to /company when subscriberOnly is true', () => {
    authMock.isAuthenticated = true;
    authMock.user = { id: 'u1' };
    authMock.hasRole = (role: string) => role === 'company_admin';
    renderWithRoutes('/protected', undefined, true);
    expect(screen.getByText('Company Dashboard')).toBeInTheDocument();
  });

  it('redirects analyst to /admin/:slug when subscriberOnly is true', () => {
    authMock.isAuthenticated = true;
    authMock.user = { id: 'u1', expertSlug: 'alice' };
    authMock.hasRole = (role: string) => role === 'analyst';
    renderWithRoutes('/protected', undefined, true);
    expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
  });
});
