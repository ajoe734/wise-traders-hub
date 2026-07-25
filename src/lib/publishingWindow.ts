/**
 * 發布時段限制：週一 08:00 ~ 週五 20:00（台灣時間 UTC+8）
 * 兩種派系的分析師共用此限制。
 */
export function isPublishingWindowOpen(): { open: boolean; reason?: string } {
  const now = new Date();
  // Convert to Taiwan time (UTC+8)
  const twOffset = 8 * 60; // minutes
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const tw = new Date(utcMs + twOffset * 60000);
  const day = tw.getDay(); // 0=Sun, 6=Sat
  const hhmm = tw.getHours() * 100 + tw.getMinutes();

  if (day === 0) {
    return { open: false, reason: '週末不開放發布，下週五 20:00 統一開放' };
  }
  if (day === 6) {
    return { open: false, reason: '週末不開放發布，下週五 20:00 統一開放' };
  }
  if (day === 1 && hhmm < 800) {
    return { open: false, reason: '週一 08:00 前不開放發布' };
  }
  if (day === 5 && hhmm >= 2000) {
    return { open: false, reason: '週五 20:00 後不開放發布，下週五 20:00 統一開放' };
  }
  // Tue-Thu all day, Mon after 8AM, Fri before 8PM
  return { open: true };
}

/** 取得指定時刻的台灣自然日（YYYY-MM-DD） */
function taiwanDateStr(d: Date): string {
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
  const tw = new Date(utcMs + 8 * 60 * 60000);
  const y = tw.getFullYear();
  const m = String(tw.getMonth() + 1).padStart(2, '0');
  const day = String(tw.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 訊號／週記是否仍可被分析師收回（rollback）。
 * 規則：必須在「發布當日（台灣時間 Asia/Taipei）」內；跨自然日後即不可收回。
 * pending（尚未發布）視為可收回。
 */
export function canRecallSignal(publishedAt: string | Date | null | undefined): {
  ok: boolean;
  reason?: string;
} {
  if (!publishedAt) return { ok: true };
  const pub = typeof publishedAt === 'string' ? new Date(publishedAt) : publishedAt;
  if (Number.isNaN(pub.getTime())) return { ok: true };
  if (taiwanDateStr(pub) === taiwanDateStr(new Date())) return { ok: true };
  return { ok: false, reason: '已過發布當日（台灣時間），不可收回；如需修正請聯絡管理員' };
}

