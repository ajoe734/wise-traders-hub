import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock layout
vi.mock('@/components/layouts/UnifiedAppLayout', () => ({
  UnifiedAppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock auth — AppCheckout reads useAuth() to identify the buyer
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'u1@test.io' }, isLoading: false }),
}));

// Mock the subscription confirmation hook (uses useNavigate internally),
// since the test isn't exercising the ACpay return-redirect path.
vi.mock('@/hooks/checkout/useSubscriptionConfirmation', () => ({
  useSubscriptionConfirmation: () => ({}),
}));

// Mock the ACpay SDK loader so we don't try to inject a real script tag
vi.mock('@/hooks/checkout/useAcpaySdk', () => ({
  useAcpaySdk: () => ({ getPrime: async () => 'SIMULATE_PRIME' }),
}));

// Mock plan loader
vi.mock('@/hooks/useExpertPlans', () => ({
  usePlan: () => ({
    data: {
      id: 'plan-1',
      name: '訊號方案',
      plan_type: 'analyst_signal_l1',
      price_monthly: 599,
      price_yearly: 5990,
      experts: { id: 'exp-1', name: 'Alice', slug: 'alice', avatar_url: '', role: 'advisor' },
    },
    isLoading: false,
  }),
}));

// AppCheckout 呼叫 usePlanExpertStatus 決定是否顯示「已訂閱」等狀態，
// 底層是 react-query；測試不掛 QueryClientProvider，直接把 hook mock 掉。
vi.mock('@/hooks/checkout/usePlanExpertStatus', () => ({
  usePlanExpertStatus: () => ({ data: null, isLoading: false }),
}));

// Mock supabase to short-circuit any side calls
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => {
  const providersRow = [{ id: 'prov-acpay', provider_type: 'acpay', is_active: true, is_default: true }];
  const makeChain = (payload: any) => {
    const p = Promise.resolve(payload);
    const chain: any = {};
    const methods = ['select','insert','update','delete','upsert','eq','neq','gt','gte','lt','lte','in','is','not','or','match','order','limit'];
    for (const m of methods) chain[m] = vi.fn(() => chain);
    chain.single = vi.fn().mockResolvedValue(payload);
    chain.maybeSingle = vi.fn().mockResolvedValue(payload);
    chain.then = p.then.bind(p);
    chain.catch = p.catch.bind(p);
    chain.finally = p.finally.bind(p);
    return chain;
  };
  return {
    supabase: {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: (table: string) => {
        if (table === 'payment_providers_safe') return makeChain({ data: providersRow, error: null });
        return makeChain({ data: null, error: null });
      },
      functions: { invoke: invokeMock },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
      removeChannel: () => {},
    },
  };
});

// Spy on alert to verify it is NOT called
const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

import AppCheckout from '@/pages/app/AppCheckout';

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/checkout/:slug/:planId" element={<AppCheckout />} />
          <Route path="/app/expert/:slug" element={<div>Expert Page</div>} />
          <Route path="/app" element={<div>App Home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AppCheckout ACpay validation', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    alertSpy.mockClear();
  });

  it('blocks submission when cardholder fields are empty', async () => {
    renderAt('/app/checkout/alice/plan-1');
    // Switch to ACpay
    fireEvent.click(screen.getByText('ACpay'));
    // Click pay
    fireEvent.click(screen.getByRole('button', { name: /ACpay 付款/ }));

    await waitFor(() => {
      expect(screen.getByText('請輸入英文姓名')).toBeInTheDocument();
      expect(screen.getByText('請輸入電子郵件')).toBeInTheDocument();
      expect(screen.getByText('請輸入手機號碼')).toBeInTheDocument();
    });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('rejects non-English cardholder name', async () => {
    renderAt('/app/checkout/alice/plan-1');
    fireEvent.click(screen.getByText('ACpay'));
    fireEvent.change(screen.getByLabelText(/英文姓名/), { target: { value: '王大明' } });
    fireEvent.change(screen.getByLabelText(/電子郵件/), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText(/手機號碼/), { target: { value: '912345678' } });
    fireEvent.click(screen.getByRole('button', { name: /ACpay 付款/ }));

    await waitFor(() => expect(screen.getByText('姓名須為英文字母')).toBeInTheDocument());
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('rejects malformed cardholder email', async () => {
    renderAt('/app/checkout/alice/plan-1');
    fireEvent.click(screen.getByText('ACpay'));
    fireEvent.change(screen.getByLabelText(/英文姓名/), { target: { value: 'WANG DA MING' } });
    fireEvent.change(screen.getByLabelText(/電子郵件/), { target: { value: 'invalid' } });
    fireEvent.change(screen.getByLabelText(/手機號碼/), { target: { value: '912345678' } });
    fireEvent.click(screen.getByRole('button', { name: /ACpay 付款/ }));

    await waitFor(() => expect(screen.getByText('電子郵件格式不正確')).toBeInTheDocument());
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('rejects phone with wrong digit count', async () => {
    renderAt('/app/checkout/alice/plan-1');
    fireEvent.click(screen.getByText('ACpay'));
    fireEvent.change(screen.getByLabelText(/英文姓名/), { target: { value: 'WANG DA MING' } });
    fireEvent.change(screen.getByLabelText(/電子郵件/), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText(/手機號碼/), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: /ACpay 付款/ }));

    await waitFor(() => expect(screen.getByText('手機號碼須為 9-10 位數字')).toBeInTheDocument());
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('clears the name error after typing', async () => {
    renderAt('/app/checkout/alice/plan-1');
    fireEvent.click(screen.getByText('ACpay'));
    fireEvent.click(screen.getByRole('button', { name: /ACpay 付款/ }));
    await waitFor(() => expect(screen.getByText('請輸入英文姓名')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/英文姓名/), { target: { value: 'A' } });
    expect(screen.queryByText('請輸入英文姓名')).not.toBeInTheDocument();
  });

  it('never invokes window.alert for validation errors', async () => {
    renderAt('/app/checkout/alice/plan-1');
    fireEvent.click(screen.getByText('ACpay'));
    fireEvent.click(screen.getByRole('button', { name: /ACpay 付款/ }));
    await waitFor(() => expect(screen.getByText('請輸入英文姓名')).toBeInTheDocument());
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
