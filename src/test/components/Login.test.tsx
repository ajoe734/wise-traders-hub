import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

// Mock layout to avoid pulling NotificationBell / supabase fetches
vi.mock('@/components/layouts/PortalLayout', () => ({
  PortalLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const loginMock = vi.fn();
const toastMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    login: loginMock,
    user: null,
    isAuthenticated: false,
    hasRole: () => false,
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

import Login from '@/pages/auth/Login';

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
}

describe('Login form validation', () => {
  beforeEach(() => {
    loginMock.mockReset();
    toastMock.mockReset();
    navigateMock.mockReset();
  });

  it('shows red border + error text when email and password are empty', async () => {
    renderLogin();
    const submit = screen.getByRole('button', { name: '登入' });
    // Bypass the browser-native required check for this assertion
    const form = submit.closest('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText('請輸入電子郵件')).toBeInTheDocument();
      expect(screen.getByText('請輸入密碼')).toBeInTheDocument();
    });
    const emailInput = screen.getByLabelText('電子郵件') as HTMLInputElement;
    const passwordInput = screen.getByLabelText('密碼') as HTMLInputElement;
    expect(emailInput.className).toContain('border-destructive');
    expect(passwordInput.className).toContain('border-destructive');
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('clears the email error after the user starts typing', async () => {
    renderLogin();
    const form = screen.getByRole('button', { name: '登入' }).closest('form')!;
    fireEvent.submit(form);

    await waitFor(() => expect(screen.getByText('請輸入電子郵件')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('電子郵件'), { target: { value: 'a' } });
    expect(screen.queryByText('請輸入電子郵件')).not.toBeInTheDocument();
  });

  it('calls login() when fields are filled', async () => {
    loginMock.mockResolvedValue({ success: true });
    renderLogin();

    fireEvent.change(screen.getByLabelText('電子郵件'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('a@b.co', 'secret123');
    });
  });

  it('shows toast on login failure but does not redirect', async () => {
    loginMock.mockResolvedValue({ success: false, error: '帳號或密碼錯誤' });
    renderLogin();
    fireEvent.change(screen.getByLabelText('電子郵件'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: '登入失敗', variant: 'destructive' }),
      );
    });
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
