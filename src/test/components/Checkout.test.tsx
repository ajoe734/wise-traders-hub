import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Mock layout to skip header / supabase fetches inside it
vi.mock('@/components/layouts/PortalLayout', () => ({
  PortalLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock useAuth
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'a@b.co' },
    isAuthenticated: true,
    isLoading: false,
    hasRole: () => false,
  }),
}));

// Mock supabase client. Build chainable .from(...) that resolves to the right shape
// for each table the page queries during initial fetch.
const planRow = {
  id: 'plan-1',
  name: '訊號方案',
  plan_type: 'analyst_signal_l1',
  price_monthly: 599,
  price_yearly: 5990,
  description: null,
  features: null,
  expert_id: 'exp-1',
};
const expertRow = {
  id: 'exp-1',
  name: 'Alice',
  slug: 'alice',
  avatar_url: '',
  role: 'advisor',
};
const acpayProvider = {
  id: 'prov-acpay',
  display_name: 'ACpay 信用卡',
  provider_type: 'acpay',
  is_active: true,
  is_default: true,
};

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => {
  const buildQuery = (table: string) => {
    const chain: any = {};
    const result = (() => {
      if (table === 'expert_plans') return { data: planRow, error: null };
      if (table === 'experts') return { data: expertRow, error: null };
      if (table === 'payment_providers_safe') return { data: [acpayProvider], error: null };
      if (table === 'member_subscriptions') return { data: [], error: null };
      return { data: null, error: null };
    })();
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.order = () => Promise.resolve(result);
    chain.single = () => Promise.resolve(result);
    chain.maybeSingle = () => Promise.resolve(result);
    chain.then = (resolve: any) => Promise.resolve(result).then(resolve);
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => buildQuery(table),
      functions: { invoke: invokeMock },
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }),
      },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
      removeChannel: () => {},
    },
  };
});

const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

import Checkout from '@/pages/Checkout';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/checkout/:slug/:planId" element={<Checkout />} />
        <Route path="/expert/:slug" element={<div>Expert Page</div>} />
        <Route path="/auth/login" element={<div>Login Page</div>} />
        <Route path="/experts" element={<div>Experts Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openConsentAndConfirm() {
  // Click "確認付款" (top-level checkout trigger opens the consent dialog)
  const confirmBtn = await screen.findByRole('button', { name: /確認付款/ });
  fireEvent.click(confirmBtn);
  // Tick the consent checkbox + click 同意並繼續
  const agreeBtn = await screen.findByRole('button', { name: /同意並繼續/ });
  // Find the checkbox inside the dialog and check it
  const checkbox = document.querySelector('[role="checkbox"]') as HTMLElement;
  if (checkbox) fireEvent.click(checkbox);
  fireEvent.click(agreeBtn);
}

describe('Checkout ACpay validation', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    alertSpy.mockClear();
  });

  it('blocks submission when ACpay cardholder fields are empty', async () => {
    renderAt('/checkout/alice/plan-1');
    // Wait for plan to load
    await screen.findByText('訊號方案');

    await openConsentAndConfirm();

    await waitFor(() => {
      expect(screen.getByText('請輸入英文姓名')).toBeInTheDocument();
      expect(screen.getByText('請輸入電子郵件')).toBeInTheDocument();
      expect(screen.getByText('請輸入手機號碼')).toBeInTheDocument();
    });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('clears name error after the user types', async () => {
    renderAt('/checkout/alice/plan-1');
    await screen.findByText('訊號方案');
    await openConsentAndConfirm();
    await waitFor(() => expect(screen.getByText('請輸入英文姓名')).toBeInTheDocument());

    const nameInput = screen.getByLabelText(/英文姓名/);
    fireEvent.change(nameInput, { target: { value: 'A' } });
    expect(screen.queryByText('請輸入英文姓名')).not.toBeInTheDocument();
  });

  it('rejects non-ASCII cardholder name', async () => {
    renderAt('/checkout/alice/plan-1');
    await screen.findByText('訊號方案');

    fireEvent.change(screen.getByLabelText(/英文姓名/), { target: { value: '王大明' } });
    fireEvent.change(screen.getByLabelText(/電子郵件/), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText(/手機號碼/), { target: { value: '912345678' } });

    await openConsentAndConfirm();
    await waitFor(() => expect(screen.getByText('姓名須為英文字母')).toBeInTheDocument());
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('rejects malformed email', async () => {
    renderAt('/checkout/alice/plan-1');
    await screen.findByText('訊號方案');

    fireEvent.change(screen.getByLabelText(/英文姓名/), { target: { value: 'WANG' } });
    fireEvent.change(screen.getByLabelText(/電子郵件/), { target: { value: 'oops' } });
    fireEvent.change(screen.getByLabelText(/手機號碼/), { target: { value: '912345678' } });

    await openConsentAndConfirm();
    await waitFor(() => expect(screen.getByText('電子郵件格式不正確')).toBeInTheDocument());
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('rejects phone with wrong digit count', async () => {
    renderAt('/checkout/alice/plan-1');
    await screen.findByText('訊號方案');

    fireEvent.change(screen.getByLabelText(/英文姓名/), { target: { value: 'WANG' } });
    fireEvent.change(screen.getByLabelText(/電子郵件/), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText(/手機號碼/), { target: { value: '12345' } });

    await openConsentAndConfirm();
    await waitFor(() => expect(screen.getByText('手機號碼須為 9-10 位數字')).toBeInTheDocument());
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
