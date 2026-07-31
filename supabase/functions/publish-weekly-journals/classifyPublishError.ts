/**
 * Classify a DB / RPC publish error raised inside publish-weekly-journals into
 * a mentor-facing notification payload (title / body / link) plus a stable
 * `kind` used for aggregate logging.
 *
 * Imported by `index.ts` at runtime AND by `index_test.ts` for unit tests —
 * keeps the contract single-sourced so the partial-failure notification
 * payload cannot silently drift.
 */
import { adminCapitalUrl, adminSignalsUrl, buildNotificationRow } from '../_shared/routes.ts';

export type PublishErrorKind =
  | 'CAPITAL_EXCEEDED'
  | 'INCOMPATIBLE_UNIT'
  | 'UNIT_CONFLICT'
  | 'OVERSELL'
  | 'SYMBOL_INVALID'
  | 'TRANSIENT'
  | 'UNKNOWN';

export interface PublishErrorInfo {
  kind: PublishErrorKind;
  title: string;
  body: string;
  link: string;
  /** transient error → 呼叫端可決定 retry */
  retryable: boolean;
}

/**
 * PG transient error codes（可安全重試）：
 *  - 40001 serialization_failure
 *  - 40P01 deadlock_detected
 *  - 57014 query_canceled
 *  - 08006/08003/08000 connection_*
 *  - 53300 too_many_connections
 *  - 55P03 lock_not_available
 */
const TRANSIENT_PG_CODES = new Set([
  '40001', '40P01', '57014', '08006', '08003', '08000', '53300', '55P03',
]);

const TRANSIENT_MSG_PATTERNS = [
  /fetch failed/i,
  /network/i,
  /timeout/i,
  /timed out/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /socket hang up/i,
  /temporarily unavailable/i,
  /could not serialize/i,
  /deadlock detected/i,
];

export function isTransientError(err: any): boolean {
  if (!err) return false;
  const code = String(err?.code || '');
  if (TRANSIENT_PG_CODES.has(code)) return true;
  const msg = String(err?.message || '') + ' ' + String(err?.details || '') + ' ' + String(err?.hint || '');
  return TRANSIENT_MSG_PATTERNS.some((r) => r.test(msg));
}

export function classifyPublishError(
  err: any,
  instrument: string,
  /** 導師 slug：/admin/* route 是 /admin/:expertSlug/...，缺 slug 會 404。 */
  expertSlug?: string | null,
): PublishErrorInfo {
  const signalsLink = adminSignalsUrl(expertSlug);
  const capitalLink = adminCapitalUrl(expertSlug);
  const raw =
    String(err?.message || '') +
    ' ' +
    String(err?.details || '') +
    ' ' +
    String(err?.hint || '');
  const code = String(err?.code || '');

  // 1. Transient first — 呼叫端已耗盡 retry 才會走到分類，這裡標 retryable=true 讓上層記錄
  if (isTransientError(err)) {
    return {
      kind: 'TRANSIENT',
      title: `週記發布暫時失敗：連線／資料庫忙碌（${instrument}）`,
      body: '系統當下連線或鎖資源忙碌，已自動重試但仍未成功。稍等 1–2 分鐘後再嘗試送出，若持續失敗請通知管理員。',
      link: signalsLink,
      retryable: true,
    };
  }

  if (raw.includes('CAPITAL_EXCEEDED') || (code === 'P0001' && raw.includes('capital'))) {
    return {
      kind: 'CAPITAL_EXCEEDED',
      title: `週記發布失敗：初始資金不足（${instrument}）`,
      body: '本次發布累計金額超過分析師設定的初始資金。請前往「分析師設定」上調初始資金，或調整此筆持倉的張數/價位後再送出。',
      link: capitalLink,
      retryable: false,
    };
  }
  if (raw.includes('incompatible_unit_for_asset_class')) {
    return {
      kind: 'INCOMPATIBLE_UNIT',
      title: `週記發布失敗：單位與資產類別不符（${instrument}）`,
      body: '該資產類別不允許此單位（例：美股僅能用「股」）。請至週記編輯頁選擇正確單位後重新送審。',
      link: signalsLink,
      retryable: false,
    };
  }
  if (raw.includes('unit_conflict') || raw.includes('UNIT_MIX') || raw.includes('unit_lock')) {
    return {
      kind: 'UNIT_CONFLICT',
      title: `週記發布失敗：單位與歷史紀錄衝突（${instrument}）`,
      body: '此標的歷史紀錄與本次送出的單位不一致。請於編輯頁使用「改單位…」批次校齊後再送審。',
      link: signalsLink,
      retryable: false,
    };
  }
  if (raw.includes('OVERSELL') || raw.includes('oversell') || raw.includes('exceeds_open_quantity')) {
    return {
      kind: 'OVERSELL',
      title: `週記發布失敗：賣出數量超過持倉（${instrument}）`,
      body: '此標的賣出/平損的數量超過目前未平倉部位。請至週記編輯頁修正數量或改為「平倉全部」後重新送審。',
      link: signalsLink,
      retryable: false,
    };
  }
  if (raw.includes('invalid_symbol') || raw.includes('INVALID_SYMBOL') || raw.includes('unknown_asset')) {
    return {
      kind: 'SYMBOL_INVALID',
      title: `週記發布失敗：標的代碼無效（${instrument}）`,
      body: '此代碼無法對應到任何合法資產（例如：美股缺英文代碼、台股缺 4 位數字）。請於編輯頁修正代碼後再送審。',
      link: signalsLink,
      retryable: false,
    };
  }
  return {
    kind: 'UNKNOWN',
    title: `週記發布失敗（${instrument}）`,
    body: `系統錯誤：${err?.message || '未知原因'}。請聯絡管理員或於編輯頁重試。`,
    link: signalsLink,
    retryable: false,
  };
}

/**
 * Build the exact `notifications` row inserted for a mentor when publish fails.
 * Mirrors the payload written in index.ts so tests assert against a shared shape.
 */
export function buildMentorFailureNotification(params: {
  mentorUserId: string;
  signalId: string;
  info: PublishErrorInfo;
}) {
  return buildNotificationRow({
    userId: params.mentorUserId,
    title: params.info.title,
    body: `${params.info.body}

[Signal ID] ${params.signalId}`,
    type: 'error',
    link: params.info.link,
  });
}

/**
 * Retry an async op with exponential backoff on transient errors.
 * - 預設最多 3 次（總嘗試 = 1 + 2 retries）
 * - backoff: 200ms, 600ms, 1800ms (× jitter 0.7~1.3)
 * - 非 transient 立即拋出
 * - 回傳 { result, attempts, lastError }
 */
export async function retryTransient<T>(
  op: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number; onRetry?: (attempt: number, err: any) => void } = {},
): Promise<{ result: T; attempts: number }> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelay = opts.baseDelayMs ?? 200;
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await op();
      return { result, attempts: attempt };
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err) || attempt === maxAttempts) throw err;
      opts.onRetry?.(attempt, err);
      const jitter = 0.7 + Math.random() * 0.6;
      const delay = Math.round(baseDelay * Math.pow(3, attempt - 1) * jitter);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
