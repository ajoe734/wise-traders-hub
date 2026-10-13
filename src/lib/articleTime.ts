import { taipeiClockOf } from '@/lib/taipeiWeek';

/** 台北時間 `YYYY/MM/DD HH:mm`。 */
export function fmtTaipeiDateTime(iso: string | Date): string {
  const c = taipeiClockOf(iso instanceof Date ? iso : new Date(iso));
  return `${c.date.replace(/-/g, '/')} ${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
}

/** 資料庫錯誤碼轉成老師看得懂的話。 */
export function articleSaveErrorMessage(msg: string): string {
  const m = /ARTICLE_WEEKLY_LIMIT_REACHED:(\d+)/.exec(msg);
  if (m) return `這週已經發滿 ${m[1]} 篇了（你設定的每週上限），可以先存草稿或改到下週公開。`;
  if (msg.includes('ARTICLE_PUBLISH_AT_REQUIRED')) return '缺少公開時間，請重新選擇公開方式。';
  return `儲存失敗：${msg}`;
}
