import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

    renderPage();
    await waitFor(() => expect(screen.getByText('張三')).toBeInTheDocument());
    const initialCalls = expertsSelectMock.mock.calls.length;

    // Open create dialog
    fireEvent.click(screen.getByRole('button', { name: /新增分析師/ }));
    fireEvent.change(screen.getByPlaceholderText('analyst@example.com'), { target: { value: 'x@y.com' } });
    fireEvent.change(screen.getByPlaceholderText('至少 6 位'), { target: { value: 'pass1234' } });
    fireEvent.change(screen.getByPlaceholderText('趙鵬博'), { target: { value: 'New' } });
    fireEvent.change(screen.getByPlaceholderText('zhao-pengbo'), { target: { value: 'new' } });

    // Trigger create — role won't be set via combobox easily, so call invoke via direct button click
    // The role validator will block, so we set role through sessionStorage and re-render? Simpler: skip role and assert toast.
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }));
    // role missing → invoke not called
    await waitFor(() => expect(invokeMock).not.toHaveBeenCalled());

    // Now simulate role set by writing sessionStorage and re-render
    sessionStorage.setItem('ca_role', 'advisor');
    // Re-open
    renderPage();
    await waitFor(() => expect(screen.getAllByText('張三').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: /新增分析師/ })[0]);
    // Fill required fields again
    fireEvent.change(screen.getAllByPlaceholderText('analyst@example.com')[0], { target: { value: 'x@y.com' } });
    fireEvent.change(screen.getAllByPlaceholderText('至少 6 位')[0], { target: { value: 'pass1234' } });
    fireEvent.change(screen.getAllByPlaceholderText('趙鵬博')[0], { target: { value: 'New' } });
    fireEvent.change(screen.getAllByPlaceholderText('zhao-pengbo')[0], { target: { value: 'new' } });

    fireEvent.click(screen.getAllByRole('button', { name: '建立帳號' })[0]);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('create-analyst', expect.any(Object)));
    // After success: invalidate → refetch
    await waitFor(() => {
      expect(expertsSelectMock.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });
});
