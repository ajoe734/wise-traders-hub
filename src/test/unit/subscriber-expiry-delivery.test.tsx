/**
 * 老師端到期通知：送達狀態摘要（管理頁「通知老師」欄位）＋橫幅「已聯繫」標記。
 * 覆蓋三通道（站內／Email／LINE）× 送達／失敗／略過／未送，以及過期挽回名單文案。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import {
  buildDeliveryIndex, deliveryFor, deliveryBadge, CHANNEL_LABEL,
  type ExpiryReminderLedgerRow,
} from '@/lib/subscriberExpiryDelivery';
import { bannerTitle, daysLeftLabel, type ExpiringSubscriberRow } from '@/lib/subscriberExpiryReminder';

const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import { ExpiringSubscribersBanner } from '@/components/admin/ExpiringSubscribersBanner';

const fmt = (iso: string) => iso.slice(0, 10).replace(/-/g, '/');

const ledger = (o: Partial<ExpiryReminderLedgerRow> & { channels: unknown }): ExpiryReminderLedgerRow => ({
  expert_id: 'E1',
  local_date: '2026-09-19',
  reminder_type: 'subscriber_expiry_7d',
  payload: [{ subscription_id: 's1', display_name: '小明', plan_name: '修煉派', expires_on: '2026/09/22', days_left: 3 }],
  created_at: '2026-09-19T10:05:00Z',
  ...o,
});

describe('subscriberExpiryDelivery', () => {
  it('三通道全送達 → tone sent，標籤列出通道與日期', () => {
    const index = buildDeliveryIndex([ledger({
      channels: {
        inapp: { state: 'sent', at: '2026-09-19T10:05:00Z' },
        email: { state: 'sent', at: '2026-09-19T10:05:00Z' },
        line: { state: 'sent', at: '2026-09-19T10:05:00Z' },
      },
    })]);
    const b = deliveryBadge({ summary: deliveryFor(index, 's1'), status: 'expiring', remainingDays: 3, formatDate: fmt });
    expect(b.tone).toBe('sent');
    expect(b.label).toBe(`${CHANNEL_LABEL.inapp}·${CHANNEL_LABEL.email}·${CHANNEL_LABEL.line} 2026/09/19`);
    expect(b.title).toContain('站內 已送');
  });

  it('Email 失敗 → tone failed，title 帶錯誤訊息', () => {
    const index = buildDeliveryIndex([ledger({
      channels: {
        inapp: { state: 'sent', at: '2026-09-19T10:05:00Z' },
        email: { state: 'failed', at: '2026-09-19T10:05:00Z', error: 'resend 401: invalid api key' },
        line: { state: 'skipped', at: '2026-09-19T10:05:00Z', reason: 'no_line_binding' },
      },
    })]);
    const b = deliveryBadge({ summary: deliveryFor(index, 's1'), status: 'expiring', remainingDays: 1, formatDate: fmt });
    expect(b.tone).toBe('failed');
    expect(b.label).toBe('Email 失敗');
    expect(b.title).toContain('invalid api key');
    expect(b.title).toContain('老師未綁定 LINE');
  });

  it('只有站內送達、其他略過 → tone partial', () => {
    const index = buildDeliveryIndex([ledger({
      channels: {
        inapp: { state: 'sent', at: '2026-09-19T10:05:00Z' },
        email: { state: 'skipped', at: '2026-09-19T10:05:00Z', reason: 'no_teacher_email' },
        line: { state: 'skipped', at: '2026-09-19T10:05:00Z', reason: 'no_line_binding' },
      },
    })]);
    const b = deliveryBadge({ summary: deliveryFor(index, 's1'), status: 'live', remainingDays: 5, formatDate: fmt });
    expect(b.tone).toBe('partial');
    expect(b.label).toBe('站內 2026/09/19');
    expect(b.title).toContain('老師未設定 Email');
  });

  it('在窗口內但尚未送 → 待送；不在窗口 → —', () => {
    const empty = deliveryFor({}, 's1');
    expect(deliveryBadge({ summary: empty, status: 'expiring', remainingDays: 2, formatDate: fmt }).tone).toBe('pending');
    expect(deliveryBadge({ summary: empty, status: 'churned', remainingDays: -2, formatDate: fmt }).label).toBe('待送');
    expect(deliveryBadge({ summary: empty, status: 'live', remainingDays: 40, formatDate: fmt }).label).toBe('—');
    expect(deliveryBadge({ summary: empty, status: 'canceled', remainingDays: null, formatDate: fmt }).tone).toBe('none');
  });

  it('同一批次涵蓋多人 → 每一筆訂閱都掛到同一組通道結果；最新批次優先', () => {
    const index = buildDeliveryIndex([
      ledger({
        created_at: '2026-09-19T10:05:00Z',
        reminder_type: 'subscriber_expiry_churn_24h',
        payload: [{ subscription_id: 's1' }, { subscription_id: 's2' }],
        channels: { inapp: { state: 'sent', at: '2026-09-19T10:05:00Z' } },
      }),
      ledger({
        created_at: '2026-09-18T10:05:00Z',
        channels: { inapp: { state: 'failed', at: '2026-09-18T10:05:00Z', error: 'boom' } },
      }),
    ]);
    expect(deliveryFor(index, 's2').events.length).toBe(1);
    expect(deliveryFor(index, 's1').events.map((e) => e.at)).toEqual([
      '2026-09-19T10:05:00Z', '2026-09-18T10:05:00Z',
    ]);
    expect(deliveryFor(index, 's1').last?.reminder_type).toBe('subscriber_expiry_churn_24h');
    expect(deliveryBadge({ summary: deliveryFor(index, 's1'), status: 'churned', remainingDays: -1, formatDate: fmt }).tone).toBe('sent');
  });

  it('沒有 channels 或格式錯誤 → 不產生事件（舊資料相容）', () => {
    expect(buildDeliveryIndex([ledger({ channels: null })])).toEqual({});
    expect(buildDeliveryIndex([ledger({ channels: { email: { state: 'weird' } } })])).toEqual({});
    expect(buildDeliveryIndex([ledger({ channels: { inapp: { state: 'sent' } }, payload: null })])).toEqual({});
  });
});

describe('橫幅：過期挽回名單與「已聯繫」', () => {
  const row = (o: Partial<ExpiringSubscriberRow>): ExpiringSubscriberRow => ({
    subscription_id: 's1', display_name: '小明', plan_name: '修煉派', plan_type: 'mentor_weekly_journal',
    expires_at: '2026-09-22T15:59:59Z', expires_on: '2026-09-22', days_left: 3, local_date: '2026-09-19', ...o,
  });

  beforeEach(() => { rpcMock.mockReset(); window.localStorage.clear(); });

  it('標題依名單組成切換；已過期顯示「已過期」', () => {
    expect(bannerTitle([row({ days_left: 3 })])).toBe('1 位訂閱者將於 7 日內到期');
    expect(bannerTitle([row({ days_left: -1 })])).toBe('1 位訂閱者已到期未續訂');
    expect(bannerTitle([row({ days_left: 3 }), row({ days_left: -1 })])).toBe('1 位訂閱者將於 7 日內到期、1 位已到期未續訂');
    expect(daysLeftLabel(-1)).toBe('已過期');
  });

  function renderBanner() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ExpiringSubscribersBanner expertId="e1" expertSlug="lao-zhou" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('點「已聯繫」→ 呼叫 ack RPC 並重抓名單', async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === 'ack_subscriber_expiry'
        ? Promise.resolve({ data: true, error: null })
        : Promise.resolve({ data: [row({ days_left: -1 })], error: null }));
    renderBanner();
    await waitFor(() => expect(screen.getByTestId('expiring-subscribers-banner')).toBeInTheDocument());
    expect(screen.getByText('1 位訂閱者已到期未續訂')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ack-subscriber'));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('ack_subscriber_expiry', { _subscription_id: 's1', _ack: true }));
  });

  it('ack 失敗 → 顯示可理解錯誤，不 crash', async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === 'ack_subscriber_expiry'
        ? Promise.resolve({ data: null, error: { code: '42501', message: 'not owner of expert' } })
        : Promise.resolve({ data: [row({})], error: null }));
    renderBanner();
    await waitFor(() => expect(screen.getByTestId('expiring-subscribers-banner')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('ack-subscriber'));
    expect((await screen.findByTestId('ack-error')).textContent).toContain('沒有權限標記這位訂閱者');
  });
});
