/**
 * 站內通知 payload 單一資料源。
 *
 * 三種週記相關通知（導師發布失敗 / 提前開放訂閱者 / 匯出完成 company_admin）
 * 過去各自在 index.ts inline 手刻 title/body/link，link 規則沒有守衛 —— 這是先前
 * 404 事故的同類根因。本檔把三者收斂成純函式，link 一律經 `_shared/routes.ts`
 * 的 builder 產生並由 `buildNotificationRow` 驗證。
 *
 * 規則：
 * - 這裡只准回傳 `buildNotificationRow(...)` 的結果，禁止自行拼字串路徑。
 * - 新增通知種類請加在本檔，不要回頭在 edge function 裡 inline。
 */
import {
  accountNotificationsUrl,
  buildNotificationRow,
  companyUrl,
  expertDetailUrl,
} from './routes.ts';

export type NotificationRow = ReturnType<typeof buildNotificationRow>;

/** 導師週記發布失敗 —— 附可點擊的修正連結（link 由 classifyPublishError 決定）。 */
export function buildMentorFailureNotification(params: {
  mentorUserId: string;
  signalId: string;
  info: { title: string; body: string; link: string };
}): NotificationRow {
  return buildNotificationRow({
    userId: params.mentorUserId,
    title: params.info.title,
    body: `${params.info.body}\n\n[Signal ID] ${params.signalId}`,
    type: 'error',
    link: params.info.link,
  });
}

/** 提前開放：通知訂閱者本週週記已可觀看。無 slug 時退回通知中心。 */
export function buildEarlyPublishNotification(params: {
  userId: string;
  expertName?: string | null;
  expertSlug?: string | null;
  signalCount: number;
}): NotificationRow {
  const name = params.expertName || '導師';
  return buildNotificationRow({
    userId: params.userId,
    title: `${name} 本週週記已提前開放`,
    body: `${name} 老師提前公開本週 ${params.signalCount} 筆操作紀錄，點此立即查看。`,
    type: 'info',
    link: params.expertSlug ? expertDetailUrl(params.expertSlug) : accountNotificationsUrl(),
  });
}

/** 週記匯出完成 —— 通知 company_admin，一律連到「週記匯出」頁面自行下載。 */
export function buildJournalExportNotification(params: {
  userId: string;
  weekLabel: string;
  journalCount: number;
  mentorCount: number;
}): NotificationRow {
  const has = params.journalCount > 0;
  return buildNotificationRow({
    userId: params.userId,
    title: has
      ? `週記匯出完成：${params.weekLabel} 週共 ${params.journalCount} 則 / ${params.mentorCount} 位老師（Markdown）`
      : `週記匯出：${params.weekLabel} 週目前無任何已發布週記`,
    body: has
      ? `已為 ${params.mentorCount} 位老師各產出一份 Markdown 檔，請至「週記匯出」頁面下載。`
      : `本週尚無 mentor 發布週記，未產生任何檔案。`,
    type: 'journal_export',
    link: companyUrl('journals-export'),
  });
}
