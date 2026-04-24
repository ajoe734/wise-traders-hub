import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Mock layout
vi.mock('@/components/layouts/UnifiedAppLayout', () => ({
  UnifiedAppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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

// Mock supabase to short-circuit any side calls
const invokeMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }),
          }),
        }),
      }),
    }),
    functions: { invoke: invokeMock },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  },
}));

// Spy on alert to verify it is NOT called
const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

import AppCheckout from '@/pages/app/AppCheckout';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/checkout/:slug/:planId" element={<AppCheckout />} />
        <Route path="/app/expert/:slug" element={<div>Expert Page</div>} />
        <Route path="/app" element={<div>App Home</div>} />
      </Routes>
    </MemoryRouter>,
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
