// formatTaipeiDate — 全站唯一的 Asia/Taipei 日期格式化來源。
// 禁止在元件內手算 +8*3600*1000，DST 與跨年都會出錯。
// 使用 Intl.DateTimeFormat 確保正確。

const YMD_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const YMDHM_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * 回傳 YYYY/MM/DD（Asia/Taipei）。null / 無效 → 空字串。
 */
export function formatTaipeiYMD(iso: string | Date | null | undefined): string {
  if (iso == null || iso === '') return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // en-CA 輸出 YYYY-MM-DD，轉成 /
  return YMD_FORMATTER.format(d).replace(/-/g, '/');
}

/**
 * 帶 fallback 的版本：null / invalid → fallback（預設「尚未紀錄」）。
 */
export function formatTaipeiYMDWithFallback(
  iso: string | Date | null | undefined,
  fallback: string = '尚未紀錄',
): string {
  const r = formatTaipeiYMD(iso);
  return r || fallback;
}

/**
 * 回傳 YYYY/MM/DD HH:mm（Asia/Taipei，24h）。null / 無效 → 空字串。
 */
export function formatTaipeiYMDHM(iso: string | Date | null | undefined): string {
  if (iso == null || iso === '') return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // en-CA 輸出 "YYYY-MM-DD, HH:mm"
  return YMDHM_FORMATTER.format(d).replace(/-/g, '/').replace(', ', ' ');
}
