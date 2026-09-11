/**
 * Production consumer render tests for the subscriber-expiry teacher reminder.
 * These mount the real pages/components (with heavy data deps stubbed) instead of
 * asserting on source strings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { adminSignalsUrl } from '@/lib/routes';

// ── shared stubs ────────────────────────────────────────────────────────────
const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ expertSlug: 'lao-zhou' }),
  };
});

vi.mock('@/components/SEO', () => ({ SEO: () => null }));
vi.mock('@/components/layouts/AdminLayout', () => ({
  AdminLayout: ({ children }: any) => <div data-testid="admin-layout">{children}</div>,
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', expertSlug: 'lao-zhou' }, hasRole: () => false }),
}));
vi.mock('@/hooks/useEffectiveUserId', () => ({
  useEffectiveUserId: () => ({ userId: 'u1', isViewAs: false }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
  },
}));

// banner marker: proves the page actually mounts the production consumer
vi.mock('@/components/admin/ExpiringSubscribersBanner', () => ({
  ExpiringSubscribersBanner: (props: any) => (
    <div
      data-testid="banner-mount"
      data-expert-id={props.expertId ?? ''}
      data-expert-slug={props.expertSlug ?? ''}
      data-enabled={String(props.enabled)}
    />
  ),
}));

// Signals page deps
vi.mock('@/hooks/useAdminSignals', () => ({
  useAdminSignals: () => ({
    expert: { id: 'e1', slug: 'lao-zhou', role: 'mentor', asset_class: 'tw_stock' },
    signals: [],
    openInstruments: [],
    signalTemplates: [],
    loading: false,
    setSignals: vi.fn(),
    refetch: vi.fn(),
  }),
}));
vi.mock('@/pages/_adminSignals/SignalsTable', () => ({ SignalsTable: () => <div /> }));
vi.mock('@/pages/_adminSignals/SignalCreateDialog', () => ({ SignalCreateDialog: () => <div /> }));
vi.mock('@/pages/_adminSignals/EarlyPublishDialog', () => ({ EarlyPublishDialog: () => <div /> }));
vi.mock('@/pages/_adminSignals/PublicSampleDialog', () => ({ PublicSampleDialog: () => <div /> }));

// SignalEditor deps
vi.mock('@/hooks/admin/useSignalEditorData', () => ({
  useSignalEditorData: () => ({
    expert: { id: 'e1', slug: 'lao-zhou', role: 'mentor', asset_class: 'tw_stock' },
    signalTemplates: [],
    openPositions: [],
    capital: null,
    currency: 'TWD',
    loading: false,
    reloadCapital: vi.fn(),
  }),
}));
vi.mock('@/components/admin/LazyRichTextEditor', () => ({ LazyRichTextEditor: () => <div /> }));
vi.mock('@/pages/_signalEditor/JournalPreviewDialog', () => ({ JournalPreviewDialog: () => <div /> }));
vi.mock('@/pages/_signalEditor/CapitalPanel', () => ({ CapitalPanel: () => <div /> }));
vi.mock('@/pages/_signalEditor/TradeCard', () => ({ TradeCard: () => <div /> }));
vi.mock('@/hooks/useFormDraft', () => ({ useFormDraft: () => ({ discard: vi.fn() }) }));

// NotificationBell deps
const notificationsMock = vi.fn();
vi.mock('@/lib/memberDataAccess', () => ({
  fetchMemberNotifications: (...args: unknown[]) => notificationsMock(...args),
}));
vi.mock('@/lib/analytics/events', () => ({ trackRaw: vi.fn() }));

import AdminSignals from '@/pages/admin/Signals';
import SignalEditor from '@/pages/admin/SignalEditor';
import { NotificationBell } from '@/components/NotificationBell';
import { ReminderTimeDialog } from '@/pages/_companyAnalysts/ReminderTimeDialog';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('authoring pages mount the expiring-subscribers banner', () => {
  it('Signals list page mounts the banner with the owner expert', async () => {
    wrap(<AdminSignals />);
    const el = await screen.findByTestId('banner-mount');
    expect(el.getAttribute('data-expert-id')).toBe('e1');
    expect(el.getAttribute('data-expert-slug')).toBe('lao-zhou');
    expect(el.getAttribute('data-enabled')).toBe('true');
  });

  it('SignalEditor (/new) mounts the banner with the owner expert', async () => {
    wrap(<SignalEditor />);
    const el = await screen.findByTestId('banner-mount');
    expect(el.getAttribute('data-expert-id')).toBe('e1');
    expect(el.getAttribute('data-expert-slug')).toBe('lao-zhou');
    expect(el.getAttribute('data-enabled')).toBe('true');
  });
});

describe('NotificationBell routes the reminder to the authoring page', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    notificationsMock.mockReset();
  });

  it('navigates to /admin/:slug/signals for subscriber_expiry_reminder', async () => {
    notificationsMock.mockResolvedValue({
      notifications: [
        {
          id: 'n1',
          type: 'subscriber_expiry_reminder',
          title: '3 位訂閱者將於 7 日內到期',
          body: '請於本週週記中安排續訂關懷',
          link: adminSignalsUrl('lao-zhou'),
          is_read: true,
          created_at: '2026-09-11T10:00:00Z',
        },
      ],
    });
    wrap(<NotificationBell />);
    fireEvent.click(await screen.findByLabelText('通知'));
    const item = await screen.findByText('3 位訂閱者將於 7 日內到期');
    fireEvent.click(item);
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(navigateMock.mock.calls[0][0]).toBe('/admin/lao-zhou/signals');
  });
});

describe('ReminderTimeDialog persists HH:mm + timezone and degrades gracefully', () => {
  const expert = { id: 'e1', name: '老周', journal_reminder_time: '18:00:00', journal_reminder_timezone: 'Asia/Taipei' };

  it('saves the edited time and timezone', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ReminderTimeDialog expert={expert} saving={false} onClose={vi.fn()} onSave={onSave} />);
    const timeInput = await screen.findByLabelText('提醒時間（24 小時制）');
    expect((timeInput as HTMLInputElement).value).toBe('18:00');
    fireEvent.change(timeInput, { target: { value: '20:30' } });
    fireEvent.change(screen.getByLabelText('時區（IANA）'), { target: { value: 'Asia/Tokyo' } });
    fireEvent.click(screen.getByText('儲存'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('e1', {
      journal_reminder_time: '20:30',
      journal_reminder_timezone: 'Asia/Tokyo',
    }));
  });

  it('shows an understandable error (no crash) when the migration is not applied', async () => {
    const onSave = vi.fn().mockRejectedValue(
      new Error("Could not find the 'journal_reminder_time' column of 'experts' in the schema cache"),
    );
    render(<ReminderTimeDialog expert={expert} saving={false} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.click(await screen.findByText('儲存'));
    const err = await screen.findByTestId('reminder-save-error');
    expect(err.textContent).toContain('尚未完成資料庫更新');
    // dialog is still mounted → no page crash
    expect(screen.getByLabelText('時區（IANA）')).toBeInTheDocument();
  });
});
