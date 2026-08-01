/**
 * P8 · 發布守門（Publish Gate）單一資料源
 *
 * 把原本散在 `SignalEditor.handlePublish` 裡的「順序與短路規則」抽成純函式，
 * 讓守門順序可被單元測試驗證，取代脆弱的原始碼字串比對測試。
 *
 * 守門順序（短路，先命中先回）：
 *   1. NOT_EDITABLE      — 沒有編輯權限
 *   2. NO_ASSET_CLASS    — expert 未設定主打資產類別
 *   3. TEACHING_TOPIC_REQUIRED — 純教學週記未填教學主題
 *   4. BATCH_INVALID     — validateSignalBatch 回傳錯誤（僅交易週記）
 *
 * 發布視窗只決定 mentor 週記何時公開，不得阻止週記先保存為 pending。
 */

export type PublishGateCode =
  | 'NOT_EDITABLE'
  | 'NO_ASSET_CLASS'
  | 'TEACHING_TOPIC_REQUIRED'
  | 'BATCH_INVALID';

export type PublishGateResult =
  | { blocked: false; code: null; reason: null; silent: false }
  /** silent = 只擋下、不顯示 toast（無權限時 UI 本來就沒有按鈕） */
  | { blocked: true; code: PublishGateCode; reason: string | null; silent: boolean };

export interface PublishGateInput {
  canEdit: boolean;
  /** expert?.asset_class */
  assetClass: string | null | undefined;
  isTeachingOnly: boolean;
  teachingTopic: string;
  /** 交易週記才會呼叫；回傳字串代表錯誤，null/undefined 代表通過 */
  validateBatch: () => string | null | undefined;
}

export const PUBLISH_GATE_MESSAGES = {
  NO_ASSET_CLASS:
    '請先到「分析師設定」選擇主打資產類別（台股 / 美股 / 加密），才能發布訊號或週記',
  TEACHING_TOPIC_REQUIRED: '純教學週記至少要填教學主題',
} as const;

const pass: PublishGateResult = { blocked: false, code: null, reason: null, silent: false };

const block = (
  code: PublishGateCode,
  reason: string | null,
  silent = false,
): PublishGateResult => ({ blocked: true, code, reason, silent });

export function evaluatePublishGate(input: PublishGateInput): PublishGateResult {
  if (!input.canEdit) return block('NOT_EDITABLE', null, true);

  if (!input.assetClass) return block('NO_ASSET_CLASS', PUBLISH_GATE_MESSAGES.NO_ASSET_CLASS);

  if (input.isTeachingOnly) {
    if (!input.teachingTopic.trim()) {
      return block('TEACHING_TOPIC_REQUIRED', PUBLISH_GATE_MESSAGES.TEACHING_TOPIC_REQUIRED);
    }
    return pass;
  }

  const err = input.validateBatch();
  if (err) return block('BATCH_INVALID', err);

  return pass;
}
