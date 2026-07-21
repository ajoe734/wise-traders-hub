/**
 * Classify a DB / RPC publish error raised inside publish-weekly-journals into
 * a mentor-facing notification payload (title / body / link) plus a stable
 * `kind` used for aggregate logging.
 *
 * Imported by `index.ts` at runtime AND by `index_test.ts` for unit tests —
 * keeps the contract single-sourced so the partial-failure notification
 * payload cannot silently drift.
 */
export type PublishErrorKind =
  | 'CAPITAL_EXCEEDED'
  | 'INCOMPATIBLE_UNIT'
  | 'UNIT_CONFLICT'
  | 'UNKNOWN';

export interface PublishErrorInfo {
  kind: PublishErrorKind;
  title: string;
  body: string;
  link: string;
}

export function classifyPublishError(err: any, instrument: string): PublishErrorInfo {
  const raw =
    String(err?.message || '') +
    ' ' +
    String(err?.details || '') +
    ' ' +
    String(err?.hint || '');
  const code = String(err?.code || '');

  if (raw.includes('CAPITAL_EXCEEDED') || (code === 'P0001' && raw.includes('capital'))) {
    return {
      kind: 'CAPITAL_EXCEEDED',
      title: `週記發布失敗:初始資金不足(${instrument})`,
      body: '本次發布累計金額超過分析師設定的初始資金。請前往「分析師設定」上調初始資金,或調整此筆持倉的張數/價位後再送出。',
      link: '/admin/profile#capital',
    };
  }
  if (raw.includes('incompatible_unit_for_asset_class')) {
    return {
      kind: 'INCOMPATIBLE_UNIT',
      title: `週記發布失敗:單位與資產類別不符(${instrument})`,
      body: '該資產類別不允許此單位(例:美股僅能用「股」)。請至週記編輯頁選擇正確單位後重新送審。',
      link: '/admin/signals',
    };
  }
  if (raw.includes('unit_conflict') || raw.includes('UNIT_MIX')) {
    return {
      kind: 'UNIT_CONFLICT',
      title: `週記發布失敗:單位與歷史紀錄衝突(${instrument})`,
      body: '此標的歷史紀錄與本次送出的單位不一致。請於編輯頁使用「改單位…」批次校齊後再送審。',
      link: '/admin/signals',
    };
  }
  return {
    kind: 'UNKNOWN',
    title: `週記發布失敗(${instrument})`,
    body: `系統錯誤:${err?.message || '未知原因'}。請聯絡管理員或於編輯頁重試。`,
    link: '/admin/signals',
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
  return {
    user_id: params.mentorUserId,
    title: params.info.title,
    body: `${params.info.body}\n\n[Signal ID] ${params.signalId}`,
    type: 'error' as const,
    link: params.info.link,
  };
}
