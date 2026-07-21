import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';

// ---------- Mocks ----------
vi.mock('@/components/layouts/CompanyLayout', () => ({
  CompanyLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/lib/auditLog', () => ({ logAdminAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/imageTransform', () => ({ avatarUrl: (u: string) => u || '' }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const expertsData = [
  { id: 'e1', name: '張三', slug: 'zhang', role: 'advisor', status: 'active', avatar_url: '', created_by: 'u1', user_id: 'u1' },
  { id: 'e2', name: '李四', slug: 'li', role: 'mentor', status: 'suspended', avatar_url: '', created_by: null, user_id: 'u2' },
];

const expertsSelectMock = vi.fn();
const expertsUpdateChain = {
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockResolvedValue({ data: null, error: null }),
};
const lineChannelChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: null, error: null }),
};
const memberBindingChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
};
// chain that resolves with count
const bindingResolver = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockImplementation(function (this: any) {
    // last eq triggers resolution
    if ((this as any)._eqCount === undefined) (this as any)._eqCount = 0;
    (this as any)._eqCount += 1;
    if ((this as any)._eqCount >= 2) {
      return Promise.resolve({ count: 0, data: null, error: null });
    }
    return this;
  }),
};

const fromMock = vi.fn((table: string) => {
  if (table === 'experts') {
    return {
      select: vi.fn().mockReturnValue({
        order: expertsSelectMock,
      }),
      ...expertsUpdateChain,
    };
  }
  if (table === 'expert_line_channels') return lineChannelChain;
  if (table === 'member_line_bindings_analyst') return bindingResolver;
  return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: [], error: null }) };
});

const invokeMock = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (t: string) => fromMock(t),
    functions: { invoke: (...args: any[]) => invokeMock(...args) },
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin' } } }) },
  },
}));

import CompanyAnalysts from '@/pages/company/Analysts';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CompanyAnalysts />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  sessionStorage.clear();
  fromMock.mockClear();
  expertsSelectMock.mockReset();
  expertsUpdateChain.update.mockClear();
  expertsUpdateChain.eq.mockClear();
  invokeMock.mockReset();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('CompanyAnalysts', () => {
  it('shows loading then renders experts list', async () => {
    let resolveFn!: (v: any) => void;
    expertsSelectMock.mockReturnValue(new Promise((res) => { resolveFn = res; }));

    renderPage();
    expect(screen.getByText('載入中...')).toBeInTheDocument();

    resolveFn({ data: expertsData, error: null });
    await waitFor(() => {
      expect(screen.getByText('張三')).toBeInTheDocument();
      expect(screen.getByText('李四')).toBeInTheDocument();
    });
  });

  it('shows empty state when no experts', async () => {
    expertsSelectMock.mockResolvedValue({ data: [], error: null });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('尚無分析師')).toBeInTheDocument();
    });
  });

  it('handles query failure as empty list (graceful)', async () => {
    expertsSelectMock.mockResolvedValue({ data: null, error: { message: 'denied' } });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('尚無分析師')).toBeInTheDocument();
    });
  });

  it('optimistically toggles status without waiting for API', async () => {
    expertsSelectMock.mockResolvedValue({ data: expertsData, error: null });
    // Make update never resolve so we can prove optimism
    expertsUpdateChain.eq.mockImplementation(() => new Promise(() => {}));

    renderPage();
    await waitFor(() => expect(screen.getByText('張三')).toBeInTheDocument());

    // 張三 is active → button label "停用"
    const row = screen.getByText('張三').closest('tr')!;
    const btn = Array.from(row.querySelectorAll('button')).find(b => b.textContent === '停用')!;
    fireEvent.click(btn);

    await waitFor(() => {
      // badge should now show 已停用 for 張三
      expect(row.textContent).toContain('已停用');
    });
    expect(expertsUpdateChain.update).toHaveBeenCalledWith({ status: 'suspended' });
  });

  it('invalidates experts query after create-analyst succeeds', async () => {
    expertsSelectMock.mockResolvedValue({ data: expertsData, error: null });
    invokeMock.mockResolvedValue({ data: { expert_id: 'e3' }, error: null });

    // Pre-seed the dialog open + all form values (including role, which uses Radix Select)
    sessionStorage.setItem('company_analyst_create_open', 'true');
    sessionStorage.setItem('ca_email', 'x@y.com');
    sessionStorage.setItem('ca_password', 'pass1234');
    sessionStorage.setItem('ca_name', 'New');
    sessionStorage.setItem('ca_slug', 'new');
    sessionStorage.setItem('ca_role', 'advisor');

    renderPage();
    await waitFor(() => expect(screen.getByText('張三')).toBeInTheDocument());
    const initialCalls = expertsSelectMock.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('create-analyst', {
        body: { email: 'x@y.com', password: 'pass1234', name: 'New', slug: 'new', role: 'advisor' },
      });
    });
    // After success: invalidate → refetch
    await waitFor(() => {
      expect(expertsSelectMock.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  it('shows structured account reset errors instead of generic non-2xx message', async () => {
    expertsSelectMock.mockResolvedValue({ data: expertsData, error: null });
    invokeMock
      .mockResolvedValueOnce({ data: { email: 'analyst@example.com', is_line_virtual: false }, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: {
          message: 'Edge Function returned a non-2xx status code',
          context: new Response(JSON.stringify({
            code: 'PASSWORD_TOO_SHORT',
            error: '密碼至少需 8 碼',
            request_id: 'abcdef1234567890',
          }), { status: 400, headers: { 'x-correlation-id': 'abcdef1234567890' } }),
        },
      });

    renderPage();
    await waitFor(() => expect(screen.getByText('張三')).toBeInTheDocument());

    const row = screen.getByText('張三').closest('tr')!;
    const accountButton = Array.from(row.querySelectorAll('button')).find(b => b.textContent === '帳號')!;
    fireEvent.click(accountButton);

    await waitFor(() => expect(screen.getByText(/目前 Email/)).toBeInTheDocument());
    const passwordTab = screen.getByRole('tab', { name: /重設密碼/ });
    fireEvent.pointerDown(passwordTab, { button: 0, ctrlKey: false });
    fireEvent.mouseDown(passwordTab, { button: 0, ctrlKey: false });
    fireEvent.click(passwordTab);
    await waitFor(() => expect(screen.getByPlaceholderText('至少 8 碼，需含英文與數字')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('至少 8 碼，需含英文與數字'), { target: { value: 'abcd1234' } });
    fireEvent.change(screen.getByPlaceholderText('再次輸入'), { target: { value: 'abcd1234' } });
    fireEvent.click(screen.getByRole('button', { name: '立即重設' }));

    await waitFor(() => {
      expect(screen.getByText(/密碼至少需 8 碼/)).toBeInTheDocument();
    });
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('密碼至少需 8 碼'));
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringContaining('Edge Function returned a non-2xx status code'));
  });
});
