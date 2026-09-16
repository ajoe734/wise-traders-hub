/**
 * bsrProviderPresentation — 券商分點（BSR）「上游授權狀態」的**唯一 production state model**。
 *
 * 為什麼存在：授權缺口（terminal_provider_rejected）過去在三個地方各自拼字串：
 * 卡片 secondary、抽屜分段新鮮度、抽屜失敗診斷 banner。結果是
 *   1. 卡片出現「券商分點 … 券商分點資料源需授權」的重複感；
 *   2. 授權中止後 worker 早就停了，banner 卻仍印「已嘗試回推 8/17 ~ 8/17」，
 *      讓使用者以為系統還在重試；
 *   3. 沒有任何地方能一眼看出「缺的是哪一種授權」。
 *
 * 憲法：
 *   - 純函式：不打 API、不碰 DOM、不寫狀態。
 *   - terminal 與 transient 是**兩種不同事實**，不得共用文案或共用回推區間。
 *   - 卡片列文案不得再自帶「券商分點資料源需授權」；卡片說的是「更新暫停 + 最後成功日」。
 *   - 抽屜 provider 段才明講缺的授權名稱（FinMind Sponsor），因為那裡是診斷語境。
 *   - 三大法人的新鮮度與本模組完全無關，不得由 BSR 狀態推導。
 */
import { isTerminalUnavailable } from '@/checkup/lib/bsrCanonicalCodes';

/** 卡片列：券商分點停更（不重複「需授權」字樣，避免與段落標題疊字）。 */
export const BSR_TEXT_PAUSED = '券商分點更新暫停';
/** 抽屜 provider 段：明講缺的授權。 */
export const BSR_TEXT_ENTITLEMENT_PENDING = 'FinMind Sponsor 授權未開通';
/** terminal 時的回推說明：授權中止後 worker 已停，沒有任何新嘗試。 */
export const BSR_TEXT_NO_RETRY_SINCE_ENTITLEMENT = '授權中止後未再嘗試';
/** CAPTCHA/OCR 舊路徑被 production selector 拒絕的唯一理由字串（機器可讀）。 */
export const CAPTCHA_FALLBACK_BLOCKED_REASON = 'captcha_fallback_disabled';

export interface BsrProviderFactsInput {
  providerState?: string | null;
  providerCode?: string | null;
}

/** `2026-08-14` → `2026/08/14`；無值回 null。 */
export function formatSourceDate(d: string | null | undefined): string | null {
  return d ? String(d).split('-').join('/') : null;
}

/** terminal 判定的唯一入口（轉呼 canonical mapper，避免各處自刻）。 */
export function isEntitlementBlocked(input: BsrProviderFactsInput | null | undefined): boolean {
  return isTerminalUnavailable({
    providerState: input?.providerState ?? null,
    providerCode: input?.providerCode ?? null,
  });
}

/** 卡片 secondary：`券商分點更新暫停 · 最後成功 2026/08/14`。 */
export function bsrCardPausedLine(asOf: string | null | undefined): string {
  const d = formatSourceDate(asOf);
  return d ? `${BSR_TEXT_PAUSED} · 最後成功 ${d}` : BSR_TEXT_PAUSED;
}

/** 抽屜 provider 段：`FinMind Sponsor 授權未開通 · 最後成功 2026/08/14`。 */
export function bsrDrawerEntitlementLine(asOf: string | null | undefined): string {
  const d = formatSourceDate(asOf);
  return d ? `${BSR_TEXT_ENTITLEMENT_PENDING} · 最後成功 ${d}` : BSR_TEXT_ENTITLEMENT_PENDING;
}

export type BsrRetryNoteKind = 'none_since_entitlement' | 'range' | 'single' | 'unknown';

export interface BsrRetryNote {
  kind: BsrRetryNoteKind;
  /** 使用者可見文字（已格式化為 YYYY/MM/DD）。 */
  text: string;
}

export interface BsrRetryNoteInput {
  terminal: boolean;
  lookbackFrom?: string | null;
  lookbackTo?: string | null;
  lookbackDays?: number | null;
  tradeDate?: string | null;
}

/**
 * 回推區間的唯一決策點。
 *   - terminal：不論 DB 裡殘留哪一天，都不得再印「已嘗試回推 X ~ X」的假區間。
 *   - transient 且有完整 from/to：照實顯示真實區間（含天數）。
 *   - transient 但只有單一 trade_date：顯示那一天，不偽裝成區間。
 */
export function resolveBsrRetryNote(input: BsrRetryNoteInput): BsrRetryNote {
  if (input.terminal) {
    return { kind: 'none_since_entitlement', text: BSR_TEXT_NO_RETRY_SINCE_ENTITLEMENT };
  }
  const from = formatSourceDate(input.lookbackFrom);
  const to = formatSourceDate(input.lookbackTo);
  if (from && to) {
    const days = Number(input.lookbackDays ?? 0);
    const suffix = days > 1 ? `（共 ${days} 個日期）` : '';
    return { kind: 'range', text: `${to} ~ ${from}${suffix}` };
  }
  const single = formatSourceDate(input.tradeDate);
  if (single) return { kind: 'single', text: single };
  return { kind: 'unknown', text: '—' };
}

/**
 * D-fail-closed：TWSE 驗證碼／OCR 舊路徑的 production selector。
 *
 * 歷史 code（`tw-bsr-daily-sync`）仍保留，但只要上游是授權層拒絕（terminal），
 * 一律**不得**自動改走驗證碼路徑——那條路沒有授權、近兩個月成功率為 0，
 * 自動 fallback 只會製造假的「還在重試」訊號。
 */
export function isCaptchaFallbackAllowed(input: BsrProviderFactsInput | null | undefined): boolean {
  return !isEntitlementBlocked(input);
}

export interface CaptchaFallbackDecision {
  allowed: boolean;
  reason: string | null;
}

export function decideCaptchaFallback(
  input: BsrProviderFactsInput | null | undefined,
): CaptchaFallbackDecision {
  return isCaptchaFallbackAllowed(input)
    ? { allowed: true, reason: null }
    : { allowed: false, reason: CAPTCHA_FALLBACK_BLOCKED_REASON };
}
