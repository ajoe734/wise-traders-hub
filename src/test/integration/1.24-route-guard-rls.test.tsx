/**
 * Group 1.24 — 前端路由守衛與後端 RLS 一致性
 *
 * 測試範圍：
 *
 *   A. ProtectedRoute 組件行為（React Testing Library）：
 *      isLoading 顯示 spinner 不導向；
 *      未登入 → Navigate /auth/login（含 location.state.from 記錄原路由）；
 *      requiredRole 不符 → 顯示「權限不足」；
 *      requiredRole 符合 → 子元件渲染；
 *      subscriberOnly 對分析師 / 管理員分別導向 /admin/:slug 和 /company；
 *      subscriberOnly 對一般訂閱者放行。
 *
 *   B. drift-detection：ProtectedRoute.tsx
 *      確認導向與守衛邏輯關鍵識別字不漂移（3.6-1 ~ 3.6-4）。
 *        Navigate to="/auth/login" + state={{ from: location }}
 *        requiredRole && !hasRole(requiredRole) 條件
 *        「權限不足」文字
 *        subscriberOnly company_admin → /company
 *        subscriberOnly analyst + expertSlug → `/admin/${user.expertSlug}`
 *
 *   C. drift-detection：App.tsx 路由配置
 *      確認各路由群組的 ProtectedRoute prop 配置不漂移。
 *        /app/* 含 subscriberOnly
 *        /company/* 含 requiredRole="company_admin"
 *        /admin/:expertSlug 有 ProtectedRoute 包裹
 *
 *   D. drift-detection：AuthContext.tsx
 *      確認 isAuthenticated 定義不漂移（3.6-1 身份判定基礎）。
 *
 * 對應測試路徑：
 *   3.6-1：未登入存取 /app/* → 跳轉 /auth/login，state.from 記錄原路由
 *   3.6-2：一般會員 requiredRole="analyst" → 顯示「權限不足」
 *   3.6-3：一般會員 requiredRole="company_admin" → 顯示「權限不足」
 *   3.6-4：分析師存取 subscriberOnly 路由 → 導向 /admin/:slug；
 *           管理員存取 subscriberOnly 路由 → 導向 /company
 *
 * 注意：/admin/:expertSlug 在 App.tsx 的 ProtectedRoute 無 requiredRole，
 *       前端僅要求登入，資料層保護由 RLS 負責（Group 1.9 已驗證隔離）。
 *       isAuthenticated 定義為 !!user && !isLoading，確保 loading 中不觸發跳轉。
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ProtectedRoute } from '@/components/ProtectedRoute';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '@/contexts/AuthContext';
const mockUseAuth = vi.mocked(useAuth);

// Helper：登入頁 stub，讀取 location.state.from 供 Section A test 3 使用
function LoginStub() {
  const loc = useLocation();
  const from = (loc.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? 'none';
  return (
    <>
      <div data-testid="at-login">at-login</div>
      <div data-testid="from-pathname">{from}</div>
    </>
  );
}

const baseUser = {
  id: 'user-1',
  email: 'test@example.com',
  displayName: null as string | null,
  avatarUrl: null as string | null,
  isTester: false,
  roles: [] as Array<'company_admin' | 'analyst'>,
  expertSlug: null as string | null,
  isLineUser: false,
  lineUserId: null as string | null,
};

function buildAuth(overrides: Record<string, unknown> = {}) {
  return {
    user: null,
    supabaseUser: null,
    isLoading: false,
    isAuthenticated: false,
    hasRole: vi.fn().mockReturnValue(false),
    refreshProfile: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

// ── Section A: ProtectedRoute 組件行為 ────────────────────────────────────────

describe('ProtectedRoute 組件行為', () => {
  beforeEach(() => vi.clearAllMocks());

  it('isLoading=true → spinner 顯示、子元件不渲染、不導向登入頁（3.6-1 pre-check）', () => {
    mockUseAuth.mockReturnValue(buildAuth({ isLoading: true }));
    render(
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <div>app-content</div>
              </ProtectedRoute>
            }
          />
          <Route path="/auth/login" element={<div>login-page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByText('app-content')).not.toBeInTheDocument();
    expect(screen.queryByText('login-page')).not.toBeInTheDocument();
  });

  it('isAuthenticated=false → 導向 /auth/login（3.6-1）', () => {
    mockUseAuth.mockReturnValue(buildAuth({ isAuthenticated: false, isLoading: false }));
    render(
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <div>app-content</div>
              </ProtectedRoute>
            }
          />
          <Route path="/auth/login" element={<div>login-page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('login-page')).toBeInTheDocument();
    expect(screen.queryByText('app-content')).not.toBeInTheDocument();
  });

  it('導向 /auth/login 時 location.state.from.pathname 記錄原始路由（3.6-1）', () => {
    mockUseAuth.mockReturnValue(buildAuth({ isAuthenticated: false, isLoading: false }));
    render(
      <MemoryRouter initialEntries={['/app/signals']}>
        <Routes>
          <Route
            path="/app/signals"
            element={
              <ProtectedRoute>
                <div>signals</div>
              </ProtectedRoute>
            }
          />
          <Route path="/auth/login" element={<LoginStub />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('at-login')).toBeInTheDocument();
    expect(screen.getByTestId('from-pathname').textContent).toBe('/app/signals');
  });

  it('isAuthenticated=true、無 requiredRole → 子元件正常渲染（happy path）', () => {
    mockUseAuth.mockReturnValue(
      buildAuth({
        isAuthenticated: true,
        user: { ...baseUser },
        hasRole: vi.fn().mockReturnValue(false),
      }),
    );
    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div>protected-content</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );
    expect(screen.getByText('protected-content')).toBeInTheDocument();
  });

  it('requiredRole="company_admin"、roles=[] → 顯示「權限不足」（3.6-3）', () => {
    mockUseAuth.mockReturnValue(
      buildAuth({
        isAuthenticated: true,
        user: { ...baseUser, roles: [] },
        hasRole: vi.fn().mockReturnValue(false),
      }),
    );
    render(
      <MemoryRouter>
        <ProtectedRoute requiredRole="company_admin">
          <div>company-content</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );
    expect(screen.getByText('權限不足')).toBeInTheDocument();
    expect(screen.queryByText('company-content')).not.toBeInTheDocument();
  });

  it('requiredRole="analyst"、roles=[] → 顯示「權限不足」（3.6-2）', () => {
    mockUseAuth.mockReturnValue(
      buildAuth({
        isAuthenticated: true,
        user: { ...baseUser, roles: [] },
        hasRole: vi.fn().mockReturnValue(false),
      }),
    );
    render(
      <MemoryRouter>
        <ProtectedRoute requiredRole="analyst">
          <div>analyst-content</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );
    expect(screen.getByText('權限不足')).toBeInTheDocument();
    expect(screen.queryByText('analyst-content')).not.toBeInTheDocument();
  });

  it("requiredRole=\"company_admin\"、roles=['company_admin'] → 子元件渲染（3.6-3 pass）", () => {
    mockUseAuth.mockReturnValue(
      buildAuth({
        isAuthenticated: true,
        user: { ...baseUser, roles: ['company_admin'] },
        hasRole: vi.fn().mockImplementation((r: string) => r === 'company_admin'),
      }),
    );
    render(
      <MemoryRouter>
        <ProtectedRoute requiredRole="company_admin">
          <div>company-content</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );
    expect(screen.getByText('company-content')).toBeInTheDocument();
  });

  it('subscriberOnly + analyst + expertSlug="abc" → 導向 /admin/abc（3.6-4）', () => {
    mockUseAuth.mockReturnValue(
      buildAuth({
        isAuthenticated: true,
        user: { ...baseUser, roles: ['analyst'], expertSlug: 'abc' },
        hasRole: vi.fn().mockImplementation((r: string) => r === 'analyst'),
      }),
    );
    render(
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route
            path="/app"
            element={
              <ProtectedRoute subscriberOnly>
                <div>app-content</div>
              </ProtectedRoute>
            }
          />
          <Route path="/admin/:slug" element={<div>admin-page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('admin-page')).toBeInTheDocument();
    expect(screen.queryByText('app-content')).not.toBeInTheDocument();
  });

  it('subscriberOnly + company_admin → 導向 /company（3.6-4 管理員分支）', () => {
    mockUseAuth.mockReturnValue(
      buildAuth({
        isAuthenticated: true,
        user: { ...baseUser, roles: ['company_admin'] },
        hasRole: vi.fn().mockImplementation((r: string) => r === 'company_admin'),
      }),
    );
    render(
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route
            path="/app"
            element={
              <ProtectedRoute subscriberOnly>
                <div>app-content</div>
              </ProtectedRoute>
            }
          />
          <Route path="/company" element={<div>company-page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('company-page')).toBeInTheDocument();
    expect(screen.queryByText('app-content')).not.toBeInTheDocument();
  });

  it('subscriberOnly + 一般會員（無特殊角色）→ 子元件正常渲染（3.6-4 訂閱者通過）', () => {
    mockUseAuth.mockReturnValue(
      buildAuth({
        isAuthenticated: true,
        user: { ...baseUser, roles: [] },
        hasRole: vi.fn().mockReturnValue(false),
      }),
    );
    render(
      <MemoryRouter>
        <ProtectedRoute subscriberOnly>
          <div>subscriber-content</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );
    expect(screen.getByText('subscriber-content')).toBeInTheDocument();
  });
});

// ── Section B: drift-detection: ProtectedRoute.tsx ───────────────────────────

describe('drift-detection: ProtectedRoute.tsx 路由守衛邏輯', () => {
  let src: string;

  beforeAll(() => {
    src = readFileSync(
      resolve(process.cwd(), 'src/components/ProtectedRoute.tsx'),
      'utf-8',
    );
  });

  it('未登入導向 /auth/login 並附帶 state={{ from: location }}（3.6-1）', () => {
    expect(src).toContain('to="/auth/login"');
    expect(src).toContain('state={{ from: location }}');
  });

  it('requiredRole && !hasRole(requiredRole) 條件守衛（3.6-2/3.6-3）', () => {
    expect(src).toContain('requiredRole && !hasRole(requiredRole)');
  });

  it('顯示「權限不足」文字（3.6-2/3.6-3）', () => {
    expect(src).toContain('權限不足');
  });

  it("subscriberOnly + hasRole('company_admin') 導向 /company（3.6-4）", () => {
    expect(src).toContain("hasRole('company_admin')");
    expect(src).toContain('to="/company"');
  });

  it("subscriberOnly + hasRole('analyst') + user.expertSlug 導向 /admin/:expertSlug（3.6-4）", () => {
    expect(src).toContain("hasRole('analyst')");
    expect(src).toContain('user.expertSlug');
    expect(src).toContain('`/admin/${user.expertSlug}`');
  });
});

// ── Section C: drift-detection: App.tsx 路由配置 ─────────────────────────────

describe('drift-detection: App.tsx 路由配置', () => {
  let appSrc: string;

  beforeAll(() => {
    appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
  });

  it('/app/* 路由使用 subscriberOnly prop（3.6-4）', () => {
    // subscriberOnly 為 JSX shorthand（等同 subscriberOnly={true}）
    expect(appSrc).toContain('subscriberOnly');
  });

  it('/company/* 路由使用 requiredRole="company_admin"（3.6-3）', () => {
    expect(appSrc).toContain('requiredRole="company_admin"');
  });

  it('/admin/:expertSlug 路由有 ProtectedRoute 包裹（需 authentication，3.6-2）', () => {
    expect(appSrc).toContain('path="/admin/:expertSlug"');
    // 僅需 authentication，不含 requiredRole → 資料保護由 RLS 負責（Group 1.9）
    expect(appSrc).toContain('<ProtectedRoute><AdminDashboard');
  });
});

// ── Section D: drift-detection: AuthContext.tsx ───────────────────────────────

describe('drift-detection: AuthContext.tsx 身份判定邏輯', () => {
  let authSrc: string;

  beforeAll(() => {
    authSrc = readFileSync(
      resolve(process.cwd(), 'src/contexts/AuthContext.tsx'),
      'utf-8',
    );
  });

  it('isAuthenticated = !!user && !isLoading 確保 loading 時不算已登入（3.6-1）', () => {
    expect(authSrc).toContain('isAuthenticated = !!user && !isLoading');
  });
});

// ── Section E: drift-detection: AdminLayout.tsx 後台存取控制 ─────────────────

describe('drift-detection: AdminLayout.tsx 後台存取控制', () => {
  let adminLayoutSrc: string;

  beforeAll(() => {
    adminLayoutSrc = readFileSync(
      resolve(process.cwd(), 'src/components/layouts/AdminLayout.tsx'),
      'utf-8',
    );
  });

  it('hasAccess = isCompanyAdmin || isOwner 定義後台存取條件（3.6-2）', () => {
    // 若此行被改為只剩 isCompanyAdmin，一般分析師將失去存取自己後台的權限
    expect(adminLayoutSrc).toContain('const hasAccess = isCompanyAdmin || isOwner');
  });

  it('isOwner 以 user.expertSlug === expertSlug 比對路由 slug（3.6-2）', () => {
    // 確保 ownership 是比對登入者的 expertSlug 與 URL 中的 :expertSlug，而非其他欄位
    expect(adminLayoutSrc).toContain('user.expertSlug === expertSlug');
  });

  it('!hasAccess 時顯示「權限不足」阻擋非 owner 存取後台（3.6-2）', () => {
    expect(adminLayoutSrc).toContain('!hasAccess');
    expect(adminLayoutSrc).toContain('權限不足');
  });
});
