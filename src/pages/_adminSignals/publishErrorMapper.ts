/**
 * 把 expert_signals INSERT 錯誤（DB 觸發器丟的中／英文訊息）轉成結構化物件，
 * 讓 UI 可以顯示：精確原因 + 建議操作 + 下一步按鈕。
 *
 * 相關觸發器：
 *   - enforce_signal_capital_limit  → CAPITAL_EXCEEDED
 *   - enforce_asset_class_units     → incompatible_unit_for_asset_class
 *   - enforce_unit_consistency      → unit_conflict
 */

export type PublishErrorCode =
  | 'CAPITAL_EXCEEDED'
  | 'INCOMPATIBLE_UNIT'
  | 'UNIT_CONFLICT'
  | 'UNKNOWN';

export interface CapitalExceededMeta {
  required: number;
  available: number;
  currency: string;
}

export interface MappedPublishError {
  code: PublishErrorCode;
  /** 短標題（banner header / toast title） */
  title: string;
  /** 具體原因（含數字／幣別／單位） */
  detail: string;
  /** 使用者下一步該做什麼 */
  hint: string;
  /** 原始 DB 訊息（debug / 複製） */
  raw: string;
  /** 額外欄位，UI 可依碼分支渲染 */
  capital?: CapitalExceededMeta;
}

export function mapPublishError(
  rawMessage: string | null | undefined,
  ctx: { lockedUnit?: string | null; allowedUnits?: string[]; assetLabel?: string } = {},
): MappedPublishError {
  const raw = String(rawMessage ?? '');

  if (raw.includes('CAPITAL_EXCEEDED')) {
    // 觸發器格式：`CAPITAL_EXCEEDED: 此筆需 34000 USD，可用現金僅 30000 USD。...`
    const m = raw.match(/此筆需\s*([\d.]+)\s*(\w+)，可用現金僅\s*([-\d.]+)\s*(\w+)/);
    const required = m ? Number(m[1]) : NaN;
    const available = m ? Number(m[3]) : NaN;
    const currency = m ? m[2] : '';
    const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString() : '—');
    return {
      code: 'CAPITAL_EXCEEDED',
      title: '資金額度不足，無法發布',
      detail: m
        ? `此筆需要 ${fmt(required)} ${currency}，但目前可用現金僅 ${fmt(available)} ${currency}。`
        : '此筆所需資金已超過分析師設定的可用現金。',
      hint: '請至「分析師設定」調整初始資金，或減少此筆數量／降低參考價後再送出。',
      raw,
      capital: Number.isFinite(required) && Number.isFinite(available)
        ? { required, available, currency }
        : undefined,
    };
  }

  if (raw.includes('incompatible_unit_for_asset_class')) {
    const allowed = ctx.allowedUnits?.length ? ctx.allowedUnits.join(' / ') : '相容單位';
    return {
      code: 'INCOMPATIBLE_UNIT',
      title: '單位與資產類別不符',
      detail: ctx.assetLabel
        ? `${ctx.assetLabel}不接受此單位，僅允許 ${allowed}。`
        : `此資產類別不接受此單位，僅允許 ${allowed}。`,
      hint: '請切換為相容單位後重試，或到「分析師設定」確認主打資產類別。',
      raw,
    };
  }

  if (raw.includes('unit_conflict') || raw.toLowerCase().includes('enforce_unit_consistency')) {
    return {
      code: 'UNIT_CONFLICT',
      title: '單位與歷史紀錄不一致',
      detail: ctx.lockedUnit
        ? `此代碼歷史單位為「${ctx.lockedUnit}」，本次卻用不同單位，資料會漂移。`
        : '此代碼歷史單位與本次不一致，資料會漂移。',
      hint: '請改用歷史單位重試；若確定要整批換單位，請執行「改單位…」。',
      raw,
    };
  }

  return {
    code: 'UNKNOWN',
    title: '發布失敗',
    detail: raw || '發生未預期的錯誤。',
    hint: '請確認資料無誤後重試；若持續失敗，請將錯誤訊息回報給管理員。',
    raw,
  };
}
