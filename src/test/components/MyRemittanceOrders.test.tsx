import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------- Mocks ----------
vi.mock('@/components/layouts/PortalLayout', () => ({
  PortalLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  toast: (...args: any[]) => toastMock(...args),
}));

const useAuthMock = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

const orderRow = (overrides: any = {}) => ({
  id: 'order-1',
  product_kind: 'checkup_plan',
  billing_cycle: 'monthly',
  amount: 199,
  status: 'awaiting_info',
  last5: null,
  payer_name: null,
  created_at: new Date('2026-05-01').toISOString(),
  reject_reason: null,
  ...overrides,
});

const orderQuery = {
  data: [] as any[],
  error: null as any,
};

const orderChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockImplementation(() => Promise.resolve(orderQuery)),
};

const fromMock = vi.fn((_t: string) => orderChain);
const invokeMock = vi.fn();
const channelMock = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn().mockReturnThis(),
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (t: string) => fromMock(t),
    functions: { invoke: (...args: any[]) => invokeMock(...args) },
    channel: vi.fn(() => channelMock),
    removeChannel: vi.fn(),
  },
}));

import MyRemittanceOrders from '@/pages/account/MyRemittanceOrders';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <MyRemittanceOrders />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  fromMock.mockClear();
  orderChain.select.mockClear();
  orderChain.eq.mockClear();
  orderChain.order.mockClear();
  invokeMock.mockReset();
  toastMock.mockReset();
  orderQuery.data = [];
  orderQuery.error = null;
  useAuthMock.mockReturnValue({ user: { id: 'user-1' } });
});

describe('MyRemittanceOrders', () => {
  it('renders spinner and skips query when user is not logged in', async () => {
    useAuthMock.mockReturnValue({ user: null });
    renderPage();
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    await new Promise(r => setTimeout(r, 30));
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('shows empty state when no orders', async () => {
    orderQuery.data = [];
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('目前沒有匯款訂單。')).toBeInTheDocument();
    });
    expect(fromMock).toHaveBeenCalledWith('remittance_orders');
  });

  it('renders orders and shows input form only for awaiting_info', async () => {
    orderQuery.data = [
      orderRow({ id: 'a', status: 'awaiting_info' }),
      orderRow({ id: 'b', status: 'confirmed', last5: '12345', payer_name: '王' }),
    ];
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('待補匯款資料')).toBeInTheDocument();
      expect(screen.getByText('已開通')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('匯款人姓名')).toBeInTheDocument();
    expect(screen.getByText(/匯款人 王/)).toBeInTheDocument();
  });

  it('treats null data as empty list (graceful error)', async () => {
    orderQuery.data = null as any;
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('目前沒有匯款訂單。')).toBeInTheDocument();
    });
  });

  it('validates last5 format and disables submit', async () => {
    orderQuery.data = [orderRow({ status: 'awaiting_info' })];
    renderPage();
    await waitFor(() => screen.getByLabelText('匯款人姓名'));

    fireEvent.change(screen.getByLabelText('匯款人姓名'), { target: { value: '張三' } });
    const last5Input = screen.getByLabelText('轉出帳號末五碼');
    fireEvent.change(last5Input, { target: { value: '123' } });
    fireEvent.blur(last5Input);

    const submitBtn = screen.getByRole('button', { name: '送出對帳資料' });
    expect(submitBtn).toBeDisabled();
    expect(screen.getByText('請輸入 5 位數字')).toBeInTheDocument();

    fireEvent.click(submitBtn);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('invalidates and refetches after successful submit', async () => {
    orderQuery.data = [orderRow({ status: 'awaiting_info' })];
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });

    renderPage();
    await waitFor(() => screen.getByLabelText('匯款人姓名'));
    const initialCalls = orderChain.order.mock.calls.length;

    fireEvent.change(screen.getByLabelText('匯款人姓名'), { target: { value: '張三' } });
    fireEvent.change(screen.getByLabelText('轉出帳號末五碼'), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: '送出對帳資料' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('submit-remittance-info', expect.objectContaining({
        body: { orderId: 'order-1', last5: '12345', payerName: '張三' },
      }));
    });
    // invalidate triggers a refetch
    await waitFor(() => {
      expect(orderChain.order.mock.calls.length).toBeGreaterThan(initialCalls);
    });
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: '已送出' }));
  });

  it('surfaces toast and does not refetch on submit failure', async () => {
    orderQuery.data = [orderRow({ status: 'awaiting_info' })];
    invokeMock.mockResolvedValue({ data: null, error: { message: 'boom' } });

    renderPage();
    await waitFor(() => screen.getByLabelText('匯款人姓名'));
    const initialCalls = orderChain.order.mock.calls.length;

    fireEvent.change(screen.getByLabelText('匯款人姓名'), { target: { value: '張三' } });
    fireEvent.change(screen.getByLabelText('轉出帳號末五碼'), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: '送出對帳資料' }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: '送出失敗', variant: 'destructive' }));
    });
    // no refetch on failure
    expect(orderChain.order.mock.calls.length).toBe(initialCalls);
  });
});
