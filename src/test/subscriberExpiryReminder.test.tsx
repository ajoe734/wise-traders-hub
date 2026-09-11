import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import {
  reminderTitle,
  daysLeftLabel,
  formatExpiresOn,
  sortExpiring,
  dismissKey,
  isDismissed,
  pruneDismissed,
  shouldShowBanner,
  isValidReminderTime,
  isValidTimezone,
  normalizeReminderTime,
  type ExpiringSubscriberRow,
} from '@/lib/subscriberExpiryReminder';
import { adminSignalsUrl } from '@/lib/routes';

const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import { ExpiringSubscribersBanner } from '@/components/admin/ExpiringSubscribersBanner';

const row = (o: Partial<ExpiringSubscriberRow>): ExpiringSubscriberRow => ({
  subscription_id: 's1',
  display_name: '小明',
  plan_name: '修煉派',
  plan_type: 'mentor_weekly_journal',
  expires_at: '2026-09-14T15:59:59Z',
  expires_on: '2026-09-14',
  days_left: 3,
  local_date: '2026-09-11',
  ...o,
});

describe('subscriberExpiryReminder pure helpers', () => {
  it('title / days-left / date formats are 繁中 and YYYY/MM/DD', () => {
    expect(reminderTitle(3)).toBe('3 位訂閱者將於 7 日內到期');
    expect(daysLeftLabel(0)).toBe('今日到期');
    expect(daysLeftLabel(1)).toBe('明日到期');
    expect(daysLeftLabel(7)).toBe('剩 7 天');
    expect(formatExpiresOn('2026-09-14')).toBe('2026/09/14');
  });

  it('sorts by days_left then display_name', () => {
    const out = sortExpiring([row({ subscription_id: 'a', days_left: 7 }), row({ subscription_id: 'b', days_left: 0 })]);
    expect(out.map((r) => r.subscription_id)).toEqual(['b', 'a']);
  });

  it('dismiss key is per expert + local date; prune drops other days', () => {
    const k = dismissKey('e1', '2026-09-11');
    expect(isDismissed([k], 'e1', '2026-09-11')).toBe(true);
    expect(isDismissed([k], 'e2', '2026-09-11')).toBe(false);
    expect(isDismissed([k], 'e1', '2026-09-12')).toBe(false);
    expect(pruneDismissed([k, dismissKey('e1', '2026-09-10')], '2026-09-11')).toEqual([k]);
  });

  it('shouldShowBanner: no rows / no expert / dismissed → false', () => {
    expect(shouldShowBanner({ rows: [], dismissed: [], expertId: 'e1' })).toBe(false);
    expect(shouldShowBanner({ rows: [row({})], dismissed: [], expertId: null })).toBe(false);
    expect(shouldShowBanner({ rows: [row({})], dismissed: [dismissKey('e1', '2026-09-11')], expertId: 'e1' })).toBe(false);
    expect(shouldShowBanner({ rows: [row({})], dismissed: [], expertId: 'e1' })).toBe(true);
  });

  it('validates reminder time / timezone; normalizes DB time', () => {
    expect(isValidReminderTime('18:00')).toBe(true);
    expect(isValidReminderTime('24:00')).toBe(false);
    expect(isValidReminderTime('9:00')).toBe(false);
    expect(isValidTimezone('Asia/Taipei')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(normalizeReminderTime('18:00:00')).toBe('18:00');
    expect(normalizeReminderTime(null)).toBe('18:00');
  });

  it('notification route builder points at the authoring page', () => {
    expect(adminSignalsUrl('lao-zhou')).toBe('/admin/lao-zhou/signals');
  });
});

function renderBanner(props: Partial<React.ComponentProps<typeof ExpiringSubscribersBanner>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ExpiringSubscribersBanner expertId="e1" expertSlug="lao-zhou" {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ExpiringSubscribersBanner consumer', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    window.localStorage.clear();
  });

  it('calls the owner-scoped RPC and renders name/plan/date/days — no email/LINE', async () => {
    rpcMock.mockResolvedValue({ data: [row({}), row({ subscription_id: 's2', display_name: '阿華', days_left: 0, expires_on: '2026-09-11' })], error: null });
    renderBanner();
    await waitFor(() => expect(screen.getByTestId('expiring-subscribers-banner')).toBeInTheDocument());
    expect(rpcMock).toHaveBeenCalledWith('expiring_subscriptions_for_expert', { _expert_id: 'e1' });
    expect(screen.getByText('2 位訂閱者將於 7 日內到期')).toBeInTheDocument();
    expect(screen.getByText('小明')).toBeInTheDocument();
    expect(screen.getByText('阿華')).toBeInTheDocument();
    expect(screen.getAllByText('修煉派').length).toBe(2);
    expect(screen.getByText('2026/09/14')).toBeInTheDocument();
    expect(screen.getByTestId('expiring-subscribers-banner').textContent).not.toMatch(/@|LINE/);
  });

  it('renders nothing when RPC returns empty (8 天/取消/健檢/續訂後)', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const { container } = renderBanner();
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="expiring-subscribers-banner"]')).toBeNull();
  });

  it('is graceful when the RPC is missing/forbidden (migration not applied or teacher B → A)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    const { container } = renderBanner();
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="expiring-subscribers-banner"]')).toBeNull();
  });

  it('does not query when disabled or without expertId', () => {
    renderBanner({ enabled: false });
    renderBanner({ expertId: null });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('dismiss hides for today only (per expert)', async () => {
    rpcMock.mockResolvedValue({ data: [row({})], error: null });
    renderBanner();
    await waitFor(() => expect(screen.getByTestId('expiring-subscribers-banner')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('今天先收起'));
    expect(screen.queryByTestId('expiring-subscribers-banner')).toBeNull();
    const saved = JSON.parse(window.localStorage.getItem('lf.expiringSubscribersBanner.v1') || '{}');
    const dismissedList: string[] = saved?.data?.dismissed ?? saved?.dismissed ?? [];
    expect(dismissedList).toContain(dismissKey('e1', row({}).local_date));
  });
});
