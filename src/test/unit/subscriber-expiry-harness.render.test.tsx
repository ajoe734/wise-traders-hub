/**
 * 真正渲染 SubscriberExpiryReminderHarnessEntry：證明 harness 掛的是 production
 * ExpiringSubscribersBanner（經 useExpiringSubscribers seam）、adminSignalsUrl、ReminderTimeDialog，
 * 且 fixture 模式零 supabase 呼叫。
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const from = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) },
}));

import SubscriberExpiryReminderHarnessEntry from '@/pages/SubscriberExpiryReminderHarnessEntry';

function open(scenario: string, viewer: string) {
  window.history.replaceState({}, '', `/e2e/subscriber-expiry-reminder-harness?scenario=${scenario}&viewer=${viewer}`);
  return render(<MemoryRouter><SubscriberExpiryReminderHarnessEntry /></MemoryRouter>);
}
const text = (id: string) => screen.getByTestId(id).textContent;
const settled = () => waitFor(() => expect(text('status')).not.toBe('status=loading'));

describe('SubscriberExpiryReminderHarnessEntry', () => {
  beforeEach(() => {
    rpc.mockReset(); from.mockReset();
    window.localStorage.clear();
  });

  it('due3/A：banner 1 筆、notification 1 則、route=/admin/teacher-a/signals、marker 正確', async () => {
    open('due3', 'A');
    await settled();
    expect(text('build-marker')).toBe('build_marker=SUBSCRIBER_EXPIRY_PREVIEW_V1');
    await waitFor(() => expect(text('visible-count')).toBe('visible_count=1'));
    expect(screen.getByTestId('expiring-subscribers-banner')).toBeInTheDocument();
    expect(screen.getByText('小明')).toBeInTheDocument();
    expect(screen.getByText('剩 3 天')).toBeInTheDocument();
    expect(text('notification-count')).toBe('notification_count=1');
    expect(text('dedupe-count')).toBe('dedupe_count=0');
    expect(text('route')).toBe('route=/admin/teacher-a/signals');
    expect(screen.getByTestId('notification-link').getAttribute('href')).toBe('/admin/teacher-a/signals');
    expect(text('rpc-name')).toBe('rpc_name=expiring_subscriptions_for_expert');
    expect(text('rpc-calls')).toBe('rpc_calls=1');
    expect(text('mutation-calls')).toBe('mutation_calls=0');
    expect(text('status')).toBe('status=ok');
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('excluded/A：8 天、取消、健檢皆不可見', async () => {
    open('excluded', 'A');
    await settled();
    expect(text('rpc-calls')).toBe('rpc_calls=1');
    expect(text('visible-count')).toBe('visible_count=0');
    expect(screen.queryByTestId('expiring-subscribers-banner')).toBeNull();
    expect(text('notification-count')).toBe('notification_count=0');
    expect(text('status')).toBe('status=ok');
  });

  it('cross-tenant/B：資料屬 A，B 看不到', async () => {
    open('cross-tenant', 'B');
    await settled();
    expect(text('viewer')).toBe('viewer=B');
    expect(text('visible-count')).toBe('visible_count=0');
    expect(text('notification-count')).toBe('notification_count=0');
    expect(text('route')).toBe('route=/admin/teacher-b/signals');
    expect(screen.queryByText('小明')).toBeNull();
    expect(text('mutation-calls')).toBe('mutation_calls=0');
  });

  it('dedupe/A：同 local_date worker 兩次 → notification 1、dedupe 1', async () => {
    open('dedupe', 'A');
    await settled();
    expect(text('notification-count')).toBe('notification_count=1');
    expect(text('dedupe-count')).toBe('dedupe_count=1');
    expect(text('worker-runs')).toContain('"deduped":1');
    expect(text('mutation-calls')).toBe('mutation_calls=0');
  });

  it('renewed/A：初始可見，模擬續訂後重新查詢 → 0（rpc_calls 變 2，無 stale snapshot）', async () => {
    open('renewed', 'A');
    await waitFor(() => expect(text('visible-count')).toBe('visible_count=1'));
    fireEvent.click(screen.getByTestId('renew-and-refresh'));
    await waitFor(() => expect(text('visible-count')).toBe('visible_count=0'));
    expect(text('rpc-calls')).toBe('rpc_calls=2');
    expect(text('notification-count')).toBe('notification_count=0');
    expect(screen.queryByTestId('expiring-subscribers-banner')).toBeNull();
    expect(text('mutation-calls')).toBe('mutation_calls=0');
  });

  it('schema-error/A：不 crash，顯示可理解錯誤；ReminderTimeDialog 也顯示可理解錯誤', async () => {
    open('schema-error', 'A');
    await waitFor(() => expect(text('status')).toBe('status=error'));
    expect(screen.getByTestId('harness-error').textContent).toContain('尚未完成資料庫更新');
    expect(text('visible-count')).toBe('visible_count=0');
    fireEvent.click(screen.getByTestId('open-reminder-dialog'));
    fireEvent.click(await screen.findByText('儲存'));
    const err = await screen.findByTestId('reminder-save-error');
    expect(err.textContent).toContain('尚未完成資料庫更新');
    expect(text('mutation-calls')).toBe('mutation_calls=0');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('due3/A：ReminderTimeDialog 保存 HH:mm + timezone（fixture 不寫 DB）', async () => {
    open('due3', 'A');
    await settled();
    fireEvent.click(screen.getByTestId('open-reminder-dialog'));
    const timeInput = await screen.findByLabelText('提醒時間（24 小時制）');
    fireEvent.change(timeInput, { target: { value: '20:30' } });
    fireEvent.click(screen.getByText('儲存'));
    await waitFor(() => expect(text('dialog-saved')).toBe('dialog_saved=20:30@Asia/Taipei'));
    expect(text('mutation-calls')).toBe('mutation_calls=0');
    expect(from).not.toHaveBeenCalled();
  });
});
