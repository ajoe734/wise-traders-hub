/**
 * holdingExclusions — 單一持倉刪除的**純函式模型**（零 React、零 I/O）。
 *
 * 語意契約（C 階段）：
 *  1. 刪除 = 從目前持倉移除該檔 + 寫入一筆 owner-scoped「排除標記」。
 *  2. 絕不建立賣出交易、絕不改 trade_records / user_performances /
 *     starting_capital / cash。任何金額都不動。
 *  3. 交易日誌 replay（reconcileHoldingsWithTradeLog）必須套用排除標記，
 *     被刪掉的個股不得被 replay 復活。
 *  4. 使用者手動重新加入同一檔 → 清除該檔排除標記。
 *  5. 截圖重新匯入時，已排除的個股「預設略過」並提示；使用者明確確認
 *     才恢復（同時清除排除標記）。
 */

export const HOLDING_EXCLUSIONS_KEY = 'pf-holding-exclusions-v1';
export const HOLDINGS_KEY = 'pf-holdings-v2';
export const CALENDAR_HOLDINGS_KEY = 'pf-calendar-holdings';

/** 這些表在刪除流程中一律不得被寫入（帳務隔離硬合約）。 */
export const FORBIDDEN_WRITE_TABLES = Object.freeze([
  'trade_records',
  'user_performances',
  'expert_signals',
  'signal_legs',
]);

export interface HoldingExclusion {
  code: string;
  excludedAt: string;
}

export interface HoldingLike {
  code?: string | null;
  name?: string | null;
  [k: string]: unknown;
}

export interface CalendarHoldingsPayload {
  stocks: string;
  holdingCodes: string;
}

export function normalizeCode(code: unknown): string {
  return String(code ?? '').trim().toUpperCase();
}

/** 任何來源（雲端 JSON / localStorage / 舊格式字串陣列）→ 正規化排除清單。 */
export function parseExclusions(raw: unknown): HoldingExclusion[] {
  const rows: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { codes?: unknown[] } | null)?.codes)
      ? ((raw as { codes: unknown[] }).codes)
      : [];
  const seen = new Set<string>();
  const out: HoldingExclusion[] = [];
  for (const row of rows) {
    const code = normalizeCode(typeof row === 'string' ? row : (row as HoldingExclusion)?.code);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const at = typeof row === 'string' ? '' : String((row as HoldingExclusion)?.excludedAt ?? '');
    out.push({ code, excludedAt: at || new Date(0).toISOString() });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

export function exclusionCodes(exclusions: HoldingExclusion[]): string[] {
  return parseExclusions(exclusions).map((e) => e.code);
}

export function isExcluded(exclusions: HoldingExclusion[], code: unknown): boolean {
  const target = normalizeCode(code);
  return !!target && exclusionCodes(exclusions).includes(target);
}

/** replay / hydration 後一律先過這層，被排除的個股不得復活。 */
export function applyHoldingExclusions<T extends HoldingLike>(
  holdings: T[] | null | undefined,
  exclusions: HoldingExclusion[] | null | undefined,
): T[] {
  const list = Array.isArray(holdings) ? holdings : [];
  const codes = new Set(exclusionCodes(parseExclusions(exclusions)));
  if (codes.size === 0) return list;
  return list.filter((h) => !codes.has(normalizeCode(h?.code)));
}

/** 與 FreeCheckup 雲端同步同一口徑的日曆鏡像 payload。 */
export function calendarHoldingsPayload(holdings: HoldingLike[] | null | undefined): CalendarHoldingsPayload {
  const list = Array.isArray(holdings) ? holdings : [];
  return {
    stocks: list.map((h) => `${h?.code ?? ''} ${h?.name ?? ''}`).join('、'),
    holdingCodes: list.map((h) => String(h?.code ?? '')).filter(Boolean).sort().join(','),
  };
}

export interface HoldingLedgerFingerprint {
  holdingCodes: string;
  exclusionCodes: string;
  calendarCodes: string;
  /** 刪除流程永遠不得寫帳務表 → 恆為 0。 */
  tradeRecordWrites: number;
  cashDelta: number;
}

export function holdingLedgerFingerprint(
  holdings: HoldingLike[] | null | undefined,
  exclusions: HoldingExclusion[] | null | undefined,
  tradeRecordWrites = 0,
  cashDelta = 0,
): HoldingLedgerFingerprint {
  return {
    holdingCodes: (Array.isArray(holdings) ? holdings : [])
      .map((h) => normalizeCode(h?.code)).filter(Boolean).sort().join(','),
    exclusionCodes: exclusionCodes(parseExclusions(exclusions)).join(','),
    calendarCodes: calendarHoldingsPayload(holdings).holdingCodes,
    tradeRecordWrites,
    cashDelta,
  };
}

export interface DeletionPlan {
  ok: boolean;
  reason?: 'not-found' | 'invalid-code';
  code: string;
  nextHoldings: HoldingLike[];
  nextExclusions: HoldingExclusion[];
  nextCalendar: CalendarHoldingsPayload;
}

export function planHoldingDeletion({
  holdings,
  exclusions,
  code,
  now = new Date(),
}: {
  holdings: HoldingLike[] | null | undefined;
  exclusions: HoldingExclusion[] | null | undefined;
  code: unknown;
  now?: Date;
}): DeletionPlan {
  const target = normalizeCode(code);
  const list = Array.isArray(holdings) ? holdings : [];
  const current = parseExclusions(exclusions);
  const base: DeletionPlan = {
    ok: false,
    code: target,
    nextHoldings: list,
    nextExclusions: current,
    nextCalendar: calendarHoldingsPayload(list),
  };
  if (!target) return { ...base, reason: 'invalid-code' };
  if (!list.some((h) => normalizeCode(h?.code) === target)) return { ...base, reason: 'not-found' };

  const nextHoldings = list.filter((h) => normalizeCode(h?.code) !== target);
  const nextExclusions = parseExclusions([
    ...current.filter((e) => e.code !== target),
    { code: target, excludedAt: now.toISOString() },
  ]);
  return {
    ok: true,
    code: target,
    nextHoldings,
    nextExclusions,
    nextCalendar: calendarHoldingsPayload(nextHoldings),
  };
}

/** 手動重新加入 → 清除排除標記（不碰帳務）。 */
export function planManualReAdd({
  exclusions,
  code,
}: { exclusions: HoldingExclusion[] | null | undefined; code: unknown }): {
  code: string;
  cleared: boolean;
  nextExclusions: HoldingExclusion[];
} {
  const target = normalizeCode(code);
  const current = parseExclusions(exclusions);
  const cleared = !!target && current.some((e) => e.code === target);
  return {
    code: target,
    cleared,
    nextExclusions: cleared ? current.filter((e) => e.code !== target) : current,
  };
}

export interface ImportPlan<T extends HoldingLike> {
  accepted: T[];
  /** 預設略過的已排除個股（需 UI 提示）。 */
  skipped: string[];
  /** 使用者明確確認恢復的個股。 */
  restored: string[];
  nextExclusions: HoldingExclusion[];
}

/**
 * 截圖重匯：已排除的個股預設不匯入；只有出現在 `confirmedCodes` 的才恢復，
 * 並同步清除排除標記。
 */
export function planScreenshotImport<T extends HoldingLike>({
  incoming,
  exclusions,
  confirmedCodes = [],
}: {
  incoming: T[] | null | undefined;
  exclusions: HoldingExclusion[] | null | undefined;
  confirmedCodes?: unknown[];
}): ImportPlan<T> {
  const rows = Array.isArray(incoming) ? incoming : [];
  const current = parseExclusions(exclusions);
  const excluded = new Set(current.map((e) => e.code));
  const confirmed = new Set(confirmedCodes.map(normalizeCode).filter(Boolean));

  const accepted: T[] = [];
  const skipped: string[] = [];
  const restored: string[] = [];
  for (const row of rows) {
    const code = normalizeCode(row?.code);
    if (code && excluded.has(code)) {
      if (confirmed.has(code)) { accepted.push(row); restored.push(code); }
      else skipped.push(code);
      continue;
    }
    accepted.push(row);
  }
  const restoredSet = new Set(restored);
  return {
    accepted,
    skipped: [...new Set(skipped)].sort(),
    restored: [...restoredSet].sort(),
    nextExclusions: current.filter((e) => !restoredSet.has(e.code)),
  };
}
