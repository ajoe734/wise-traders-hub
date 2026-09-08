/**
 * importedTradeIdentity — 「一筆成交列 → canonical 持倉代號」的**單一契約**。
 *
 * 為什麼存在：手動輸入與 OCR 匯入原本各自處理 code。
 * OCR（AI JSON）有兩個已知失真來源：
 *   1. `"code": 054530` 不是合法 JSON，模型會回 `54530`（number），前導 0 遺失。
 *   2. 模型若被要求「4 位數代碼」，看到權證名稱「祥碩凱基5C購01」會回標的 5269。
 *
 * 契約（憲法）：
 *   - 權證／ETF 自己的代號才是 canonical instrument code，全程字串、保留前導 0。
 *   - 標的代號（underlying）只能當 metadata，**永遠不得**覆寫 price / history / chart 的代號。
 *   - 手動與 OCR 一律呼叫 `canonicalizeTradeCode`，不得各自猜代號。
 *
 * 補零規則的安全性：台股沒有「首位非 0 的 5 碼」證券代號（`stock_names` 內唯一 5 碼是
 * `00878`，首位為 0）。因此「5 碼純數字且首位不是 0」只可能是 6 碼權證／ETN 掉了前導 0。
 */

import { normalizeStockCode } from './stockIdentity';

/** 權證／牛熊證名稱特徵（僅作為 metadata 判定，不參與代號推導）。 */
export const WARRANT_NAME_RE = /[購售]|牛\d|熊\d/;

/** 名稱看起來是不是權證。 */
export function looksLikeWarrantName(name: unknown): boolean {
  return WARRANT_NAME_RE.test(String(name ?? ''));
}

/**
 * 還原 JSON 數值化造成的前導 0 遺失。
 * `54530` → `"054530"`；`"00878"`、`"2330"`、`"AAPL"` 原樣返回。
 */
export function restoreLeadingZeros(raw: unknown): string {
  const code = normalizeStockCode(raw);
  if (!/^\d+$/.test(code)) return code;
  if (code.length === 5 && code[0] !== '0') return `0${code}`;
  return code;
}

/**
 * canonical 成交代號。手動與 OCR 共用；不做任何名稱反查、不使用 underlying。
 */
export function canonicalizeTradeCode(rawCode: unknown, _rawName?: unknown): string {
  return restoreLeadingZeros(rawCode);
}

/** 對整列成交（OCR / 手動皆可）套用 canonical 代號，其餘欄位不動。 */
export function canonicalizeTradeRow<T extends { code?: unknown; name?: unknown }>(row: T): T {
  return { ...row, code: canonicalizeTradeCode(row?.code, row?.name) };
}

/**
 * 已錯存資料的 repair predicate（唯讀盤點用，不自動改資料）。
 * 只有「代號為 5 碼首位非 0」或「名稱是權證但代號是 4 碼標的」才視為可疑。
 */
export function isSuspectImportedIdentity(code: unknown, name: unknown): boolean {
  const c = normalizeStockCode(code);
  if (/^\d{5}$/.test(c) && c[0] !== '0') return true;
  if (looksLikeWarrantName(name) && /^\d{4}$/.test(c)) return true;
  return false;
}

/** OCR 匯入的 fail-closed 錯誤文案（權證名稱 + 標的代號）。 */
export const WARRANT_UNDERLYING_IMPORT_ERROR =
  '辨識到權證名稱，但代號疑似是標的股票，請確認權證代號或改用手動輸入';

/**
 * OCR 匯入 identity gate（fail-closed）。
 * 名稱是權證、代號卻是 4 碼標的 → 整批拒絕，不得 setParsed / persist / 發 chart request。
 * 絕不依名稱猜回權證代號。手動輸入路徑不套用此 gate。
 */
export function screenImportedTradeIdentities<T extends { code?: unknown; name?: unknown }>(
  rows: readonly T[] | null | undefined,
): { ok: boolean; accepted: T[]; rejected: T[]; error: string | null } {
  const list = Array.isArray(rows) ? rows : [];
  const rejected = list.filter((r) => {
    const c = normalizeStockCode(r?.code);
    return looksLikeWarrantName(r?.name) && /^\d{4}$/.test(c);
  });
  if (rejected.length > 0) {
    const detail = rejected
      .map((r) => `${String(r?.name ?? '').trim()}（${normalizeStockCode(r?.code)}）`)
      .join('、');
    return {
      ok: false,
      accepted: [],
      rejected,
      error: `${WARRANT_UNDERLYING_IMPORT_ERROR}：${detail}`,
    };
  }
  return { ok: true, accepted: [...list], rejected: [], error: null };
}
