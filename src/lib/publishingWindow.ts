/**
 * 發布時段限制（台灣時間 UTC+8），依市場區分：
 *   - 台股 (tw_stock / tw_futures)：週一 08:00 ~ 週五 20:00
 *   - 美股 (us_stock / us_futures / crypto)：週一 08:00 ~ 週六 08:00
 * 未知 asset_class 一律退回台股規則（多數老師）。
 */

export type MarketKind = 'TW' | 'US';

export function marketOfAssetClass(assetClass?: string | null): MarketKind {
  const c = (assetClass || '').toLowerCase();
  if (c.startsWith('us_') || c === 'crypto') return 'US';
  return 'TW';
}

function nowInTaiwan(now = new Date()): { day: number; hhmm: number } {
  const twOffset = 8 * 60;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const tw = new Date(utcMs + twOffset * 60000);
  return { day: tw.getDay(), hhmm: tw.getHours() * 100 + tw.getMinutes() };
}

/**
 * 判斷指定市場的發布視窗是否開啟。
 * @param assetClass 可傳 experts.asset_class；省略時視為 TW 規則。
 */
export function isPublishingWindowOpen(
  assetClass?: string | null,
): { open: boolean; reason?: string } {
  const market = marketOfAssetClass(assetClass);
  const { day, hhmm } = nowInTaiwan();

  // 週一 08:00 前一律鎖定
  if (day === 1 && hhmm < 800) {
    return { open: false, reason: '週一 08:00 前不開放發布' };
  }

  if (market === 'US') {
    // 美股：週日全天 & 週六 08:00 後鎖定
    if (day === 0) {
      return { open: false, reason: '週日不開放發布，本週一 08:00 再開放' };
    }
    if (day === 6 && hhmm >= 800) {
      return { open: false, reason: '週六 08:00 後不開放發布，本週六 08:00 統一開放發布' };
    }
    return { open: true };
  }

  // 台股（預設）
  if (day === 0 || day === 6) {
    return { open: false, reason: '週末不開放發布，本週五 20:00 統一開放發布' };
  }
  if (day === 5 && hhmm >= 2000) {
    return { open: false, reason: '週五 20:00 後不開放發布，本週五 20:00 統一開放發布' };
  }
  return { open: true };
}

/** 取得該市場「下一個統一發布時刻」的說明字串。 */
export function nextPublishMomentLabel(assetClass?: string | null): string {
  return marketOfAssetClass(assetClass) === 'US'
    ? '週六 08:00 統一開放發布'
    : '週五 20:00 統一開放發布';
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
