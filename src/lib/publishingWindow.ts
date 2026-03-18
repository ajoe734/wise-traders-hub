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
    return { open: false, reason: '週末不開放發布，下週一 08:00 再開放' };
  }
  if (day === 6) {
    return { open: false, reason: '週末不開放發布，下週一 08:00 再開放' };
  }
  if (day === 1 && hhmm < 800) {
    return { open: false, reason: '週一 08:00 前不開放發布' };
  }
  if (day === 5 && hhmm >= 2000) {
    return { open: false, reason: '週五 20:00 後不開放發布，下週一 08:00 再開放' };
  }
  // Tue-Thu all day, Mon after 8AM, Fri before 8PM
  return { open: true };
}
