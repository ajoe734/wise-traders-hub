import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

vi.mock('@/components/layouts/PortalLayout', () => ({
  PortalLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const registerMock = vi.fn();
const toastMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    register: registerMock,
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
  return { ...actual, useNavigate: () => navigateMock };
});

import Register from '@/pages/auth/Register';

function renderRegister() {
  return render(
    <MemoryRouter>
      <Register />
    </MemoryRouter>,
  );
}

describe('Register form validation', () => {
  beforeEach(() => {
    registerMock.mockReset();
    toastMock.mockReset();
    navigateMock.mockReset();
  });

  it('shows error text for every empty required field', async () => {
    renderRegister();
    const form = screen.getByRole('button', { name: '建立帳號' }).closest('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText('請輸入姓名')).toBeInTheDocument();
      expect(screen.getByText('請輸入電子郵件')).toBeInTheDocument();
      expect(screen.getByText('請輸入密碼')).toBeInTheDocument();
      expect(screen.getByText('請再次輸入密碼')).toBeInTheDocument();
    });
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('rejects malformed email', async () => {
    renderRegister();
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText('電子郵件'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'longenough' } });
    fireEvent.change(screen.getByLabelText('確認密碼'), { target: { value: 'longenough' } });
    fireEvent.submit(screen.getByRole('button', { name: '建立帳號' }).closest('form')!);

    await waitFor(() => expect(screen.getByText('電子郵件格式不正確')).toBeInTheDocument());
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('rejects passwords shorter than 8 characters', async () => {
    renderRegister();
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText('電子郵件'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('確認密碼'), { target: { value: 'short' } });
    fireEvent.submit(screen.getByRole('button', { name: '建立帳號' }).closest('form')!);

    await waitFor(() => expect(screen.getByText('密碼至少需要 8 個字元')).toBeInTheDocument());
  });

  it('rejects mismatched passwords', async () => {
    renderRegister();
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText('電子郵件'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'password1' } });
    fireEvent.change(screen.getByLabelText('確認密碼'), { target: { value: 'password2' } });
    fireEvent.submit(screen.getByRole('button', { name: '建立帳號' }).closest('form')!);

    await waitFor(() => expect(screen.getByText('兩次輸入的密碼不一致')).toBeInTheDocument());
  });

  it('clears name error after typing', async () => {
    renderRegister();
    fireEvent.submit(screen.getByRole('button', { name: '建立帳號' }).closest('form')!);
    await waitFor(() => expect(screen.getByText('請輸入姓名')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: 'A' } });
    expect(screen.queryByText('請輸入姓名')).not.toBeInTheDocument();
  });

  it('calls register() when all fields are valid', async () => {
    registerMock.mockResolvedValue({ success: true });
    renderRegister();
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText('電子郵件'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'longenough' } });
    fireEvent.change(screen.getByLabelText('確認密碼'), { target: { value: 'longenough' } });
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }));

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith('a@b.co', 'longenough', 'Alice');
    });
  });
});
