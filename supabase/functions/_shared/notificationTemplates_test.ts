/**
 * Parity 測試：三種週記通知 payload 都必須來自 notificationTemplates，
 * link 一律合法（validateNotificationLink === null），且不得出現絕對網址。
 */
import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  buildEarlyPublishNotification,
  buildJournalExportNotification,
  buildMentorFailureNotification,
} from './notificationTemplates.ts';
import { validateNotificationLink } from './routes.ts';

Deno.test('三種 payload 的 link 都合法且為相對路徑', () => {
  const rows = [
    buildMentorFailureNotification({
      mentorUserId: 'm1', signalId: 's1',
      info: { title: 'T', body: 'B', link: '/admin/benny/signals' },
    }),
    buildEarlyPublishNotification({ userId: 'u1', expertName: '老周', expertSlug: 'zhou', signalCount: 3 }),
    buildEarlyPublishNotification({ userId: 'u1', expertName: '老周', expertSlug: null, signalCount: 3 }),
    buildJournalExportNotification({ userId: 'a1', weekLabel: '2026/07/27', journalCount: 5, mentorCount: 2 }),
    buildJournalExportNotification({ userId: 'a1', weekLabel: '2026/07/27', journalCount: 0, mentorCount: 0 }),
  ];
  for (const r of rows) {
    assertEquals(validateNotificationLink(r.link), null, `bad link: ${r.link}`);
    assert(!String(r.link).startsWith('http'), 'link 不得為絕對網址');
    assert(r.title.length > 0 && r.body.length > 0);
    assert(!!r.user_id);
  }
});

Deno.test('mentor failure：型別 error、body 帶 Signal ID', () => {
  const r = buildMentorFailureNotification({
    mentorUserId: 'm1', signalId: 'sig-9',
    info: { title: '資金上限', body: '請調整初始資金', link: '/admin/benny/profile#capital' },
  });
  assertEquals(r.type, 'error');
  assertEquals(r.link, '/admin/benny/profile#capital');
  assert(r.body.includes('[Signal ID] sig-9'));
});

Deno.test('early publish：有 slug 走專家頁，無 slug 退回通知中心', () => {
  const withSlug = buildEarlyPublishNotification({ userId: 'u1', expertName: '老周', expertSlug: 'zhou', signalCount: 2 });
  assertEquals(withSlug.link, '/app/expert/zhou');
  assertEquals(withSlug.type, 'info');
  assert(withSlug.title.includes('老周'));
  assert(withSlug.body.includes('2 筆'));

  const noSlug = buildEarlyPublishNotification({ userId: 'u1', expertName: null, expertSlug: null, signalCount: 1 });
  assertEquals(noSlug.link, '/account/notifications');
  assert(noSlug.title.startsWith('導師'));
});

Deno.test('journal export：有無資料兩種文案，link 固定週記匯出頁', () => {
  const has = buildJournalExportNotification({ userId: 'a1', weekLabel: '2026/07/27', journalCount: 5, mentorCount: 2 });
  assertEquals(has.type, 'journal_export');
  assert(has.title.includes('共 5 則'));
  assert(has.title.includes('2 位老師'));
  assert(has.body.includes('2 位老師'));

  const empty = buildJournalExportNotification({ userId: 'a1', weekLabel: '2026/07/27', journalCount: 0, mentorCount: 0 });
  assert(empty.title.includes('無任何已發布週記'));
  assert(empty.body.includes('未產生任何檔案'));
  assertEquals(empty.link, has.link);
});

Deno.test('userId 缺失時直接丟錯（不得寫入孤兒通知）', () => {
  let threw = false;
  try {
    buildEarlyPublishNotification({ userId: '', expertName: 'x', expertSlug: 'x', signalCount: 1 });
  } catch { threw = true; }
  assert(threw);
});
