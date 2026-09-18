import { describe, it, expect } from 'vitest';
import {
  buildReminderIndex, summaryFor, reminderBadge,
  RENEWAL_EMAIL_ACTION, RENEWAL_LINE_ACTION, RENEWAL_EMAIL_FAILED_ACTION, REMINDER_DAYS,
} from '@/lib/renewalReminderStatus';

const fmt = (iso: string) => iso.slice(0, 10).replace(/-/g, '/');

describe('renewalReminderStatus', () => {
  it('indexes email + line logs by subscription and sorts newest first', () => {
    const idx = buildReminderIndex([
      { action: RENEWAL_EMAIL_ACTION, target_id: 's1', created_at: '2026-09-11T01:10:00Z', detail: { days_left: 7 } },
      { action: RENEWAL_LINE_ACTION, target_id: 's1', created_at: '2026-09-15T09:00:00Z', detail: { days_left: 3 } },
      { action: 'other.action', target_id: 's1', created_at: '2026-09-16T00:00:00Z', detail: {} },
      { action: RENEWAL_EMAIL_ACTION, target_id: null, created_at: '2026-09-16T00:00:00Z', detail: {} },
    ]);
    const s = summaryFor(idx, 's1');
    expect(s.events.length).toBe(2);
    expect(s.last?.channel).toBe('line');
    expect(s.channels.sort()).toEqual(['email', 'line']);
    expect(summaryFor(idx, 's2').events).toEqual([]);
    expect(summaryFor(idx, undefined).events).toEqual([]);
  });

  it('tolerates missing/invalid days_left', () => {
    const idx = buildReminderIndex([
      { action: RENEWAL_EMAIL_ACTION, target_id: 's1', created_at: '2026-09-11T01:10:00Z', detail: null },
      { action: RENEWAL_EMAIL_ACTION, target_id: 's2', created_at: '2026-09-11T01:10:00Z', detail: { days_left: 'x' } },
    ]);
    expect(summaryFor(idx, 's1').last?.days_left).toBeNull();
    expect(summaryFor(idx, 's2').last?.days_left).toBeNull();
  });

  it('badge: sent shows latest channel window and lists history in tooltip', () => {
    const idx = buildReminderIndex([
      { action: RENEWAL_EMAIL_ACTION, target_id: 's1', created_at: '2026-09-11T01:10:00Z', detail: { days_left: 7 } },
      { action: RENEWAL_EMAIL_ACTION, target_id: 's1', created_at: '2026-09-17T01:10:00Z', detail: { days_left: 1 } },
    ]);
    const b = reminderBadge({ summary: summaryFor(idx, 's1'), status: 'expiring', remainingDays: 1, formatDate: fmt });
    expect(b.tone).toBe('sent');
    expect(b.label).toBe('已寄 2026/09/17 · T-1');
    expect(b.title).toContain('2026/09/11 Email T-7');
  });

  it('badge: expiring without any log → 待寄；live far away → 無需提醒', () => {
    const empty = summaryFor({}, 's1');
    expect(reminderBadge({ summary: empty, status: 'expiring', remainingDays: 5, formatDate: fmt }).tone).toBe('pending');
    expect(reminderBadge({ summary: empty, status: 'live', remainingDays: 3, formatDate: fmt }).tone).toBe('pending');
    expect(reminderBadge({ summary: empty, status: 'live', remainingDays: 40, formatDate: fmt }).tone).toBe('none');
    expect(reminderBadge({ summary: empty, status: 'churned', remainingDays: -5, formatDate: fmt }).tone).toBe('none');
    expect(reminderBadge({ summary: empty, status: 'canceled', remainingDays: null, formatDate: fmt }).tone).toBe('none');
  });

  it('expired-window label reads 過期後 / 到期當日', () => {
    const idx = buildReminderIndex([
      { action: RENEWAL_EMAIL_ACTION, target_id: 's1', created_at: '2026-09-18T01:10:00Z', detail: { days_left: -1 } },
      { action: RENEWAL_EMAIL_ACTION, target_id: 's2', created_at: '2026-09-18T01:10:00Z', detail: { days_left: 0 } },
    ]);
    expect(reminderBadge({ summary: summaryFor(idx, 's1'), status: 'churned', remainingDays: -1, formatDate: fmt }).label)
      .toBe('已寄 2026/09/18 · 過期後');
    expect(reminderBadge({ summary: summaryFor(idx, 's2'), status: 'expiring', remainingDays: 0, formatDate: fmt }).label)
      .toBe('已寄 2026/09/18 · 到期當日');
  });

  it('mirrors the edge function reminder windows', () => {
    expect([...REMINDER_DAYS]).toEqual([7, 3, 1, 0, -1]);
  });
});

describe('renewalReminderStatus failures', () => {
  it('badge: failure newer than success → 寄送失敗 with provider error in tooltip', () => {
    const idx = buildReminderIndex([
      { action: RENEWAL_EMAIL_ACTION, target_id: 's1', created_at: '2026-09-11T01:10:00Z', detail: { days_left: 7 } },
      { action: RENEWAL_EMAIL_FAILED_ACTION, target_id: 's1', created_at: '2026-09-18T01:10:00Z', detail: { days_left: 0, error: 'API key is invalid' } },
    ]);
    const s = summaryFor(idx, 's1');
    expect(s.events.length).toBe(1);
    expect(s.failures.length).toBe(1);
    const b = reminderBadge({ summary: s, status: 'expiring', remainingDays: 0, formatDate: fmt });
    expect(b.tone).toBe('failed');
    expect(b.label).toBe('寄送失敗 2026/09/18 · 到期當日');
    expect(b.title).toContain('API key is invalid');
  });

  it('badge: a later success supersedes an earlier failure', () => {
    const idx = buildReminderIndex([
      { action: RENEWAL_EMAIL_FAILED_ACTION, target_id: 's1', created_at: '2026-09-11T01:10:00Z', detail: { days_left: 7 } },
      { action: RENEWAL_EMAIL_ACTION, target_id: 's1', created_at: '2026-09-15T01:10:00Z', detail: { days_left: 3 } },
    ]);
    expect(reminderBadge({ summary: summaryFor(idx, 's1'), status: 'expiring', remainingDays: 3, formatDate: fmt }).tone).toBe('sent');
  });

  it('failed logs are not counted as sent channels', () => {
    const idx = buildReminderIndex([
      { action: RENEWAL_EMAIL_FAILED_ACTION, target_id: 's1', created_at: '2026-09-18T01:10:00Z', detail: {} },
    ]);
    expect(summaryFor(idx, 's1').channels).toEqual([]);
  });
});
