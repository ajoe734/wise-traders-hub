/**
 * holdingDeleteService — 單一持倉刪除的 persistence service（production seam）。
 *
 * 保證：
 *  - owner-scoped：所有寫入都帶 user_id，gateway 自行以 RLS 再擋一層。
 *  - 三個寫入點必須一致：pf-holdings-v2、pf-calendar-holdings、
 *    pf-holding-exclusions-v1。
 *  - 任一步失敗 → 已寫入的部分**完整 rollback** 回原值，回報 ok:false。
 *  - 不得寫任何帳務表（trade_records / user_performances / 資金）。
 *    gateway 實作若嘗試寫入 FORBIDDEN_WRITE_TABLES，service 直接拒絕。
 */
import {
  CALENDAR_HOLDINGS_KEY,
  FORBIDDEN_WRITE_TABLES,
  HOLDINGS_KEY,
  HOLDING_EXCLUSIONS_KEY,
  type CalendarHoldingsPayload,
  type HoldingExclusion,
  type HoldingLike,
  calendarHoldingsPayload,
  holdingLedgerFingerprint,
  planHoldingDeletion,
  planManualReAdd,
  planScreenshotImport,
} from './holdingExclusions';

export interface HoldingPersistenceGateway {
  /** 寫入 pf-holdings-v2（本機 + 雲端）。 */
  writeHoldings(holdings: HoldingLike[]): Promise<void>;
  /** 寫入 pf-holding-exclusions-v1。 */
  writeExclusions(exclusions: HoldingExclusion[]): Promise<void>;
  /** 寫入 pf-calendar-holdings 鏡像。 */
  writeCalendar(payload: CalendarHoldingsPayload): Promise<void>;
  /** 供硬合約檢查：gateway 宣告自己會寫哪些表。 */
  writableTables?: string[];
}

export interface DeleteHoldingResult {
  ok: boolean;
  code: string;
  reason?: 'not-found' | 'invalid-code' | 'forbidden-table' | 'write-failed';
  error?: string;
  rolledBack: boolean;
  holdings: HoldingLike[];
  exclusions: HoldingExclusion[];
  calendar: CalendarHoldingsPayload;
  fingerprint: ReturnType<typeof holdingLedgerFingerprint>;
  /** 依序完成的寫入步驟（fingerprint 稽核用）。 */
  steps: string[];
}

function assertGatewaySafe(gateway: HoldingPersistenceGateway): string | null {
  const tables = gateway.writableTables ?? [];
  const bad = tables.find((t) => FORBIDDEN_WRITE_TABLES.includes(String(t)));
  return bad ? bad : null;
}

export async function deleteHoldingWithExclusion({
  gateway,
  holdings,
  exclusions,
  code,
  now = new Date(),
}: {
  gateway: HoldingPersistenceGateway;
  holdings: HoldingLike[] | null | undefined;
  exclusions: HoldingExclusion[] | null | undefined;
  code: unknown;
  now?: Date;
}): Promise<DeleteHoldingResult> {
  const prevHoldings = Array.isArray(holdings) ? holdings : [];
  const prevExclusions = Array.isArray(exclusions) ? exclusions : [];
  const prevCalendar = calendarHoldingsPayload(prevHoldings);
  const unchanged = (
    reason: DeleteHoldingResult['reason'],
    error?: string,
    rolledBack = false,
    steps: string[] = [],
  ): DeleteHoldingResult => ({
    ok: false,
    code: String(code ?? ''),
    reason,
    error,
    rolledBack,
    holdings: prevHoldings,
    exclusions: prevExclusions,
    calendar: prevCalendar,
    fingerprint: holdingLedgerFingerprint(prevHoldings, prevExclusions),
    steps,
  });

  const forbidden = assertGatewaySafe(gateway);
  if (forbidden) return unchanged('forbidden-table', `gateway 宣告會寫入禁止的表：${forbidden}`);

  const plan = planHoldingDeletion({ holdings: prevHoldings, exclusions: prevExclusions, code, now });
  if (!plan.ok) return unchanged(plan.reason);

  const steps: string[] = [];
  try {
    await gateway.writeExclusions(plan.nextExclusions);
    steps.push(HOLDING_EXCLUSIONS_KEY);
    await gateway.writeHoldings(plan.nextHoldings);
    steps.push(HOLDINGS_KEY);
    await gateway.writeCalendar(plan.nextCalendar);
    steps.push(CALENDAR_HOLDINGS_KEY);
  } catch (e) {
    // rollback：反序還原已寫入的步驟，失敗也吞掉（狀態以回傳的 prev 為準）
    const rollbackSteps = [...steps].reverse();
    for (const step of rollbackSteps) {
      try {
        if (step === CALENDAR_HOLDINGS_KEY) await gateway.writeCalendar(prevCalendar);
        if (step === HOLDINGS_KEY) await gateway.writeHoldings(prevHoldings);
        if (step === HOLDING_EXCLUSIONS_KEY) await gateway.writeExclusions(prevExclusions);
      } catch { /* best effort */ }
    }
    return unchanged('write-failed', e instanceof Error ? e.message : String(e), true, steps);
  }

  return {
    ok: true,
    code: plan.code,
    rolledBack: false,
    holdings: plan.nextHoldings,
    exclusions: plan.nextExclusions,
    calendar: plan.nextCalendar,
    fingerprint: holdingLedgerFingerprint(plan.nextHoldings, plan.nextExclusions),
    steps,
  };
}

/** 手動重新加入：只清排除標記，持倉本身由呼叫端既有流程寫入。 */
export async function clearExclusionForManualAdd({
  gateway,
  exclusions,
  code,
}: {
  gateway: HoldingPersistenceGateway;
  exclusions: HoldingExclusion[] | null | undefined;
  code: unknown;
}): Promise<{ ok: boolean; cleared: boolean; exclusions: HoldingExclusion[]; error?: string }> {
  const prev = Array.isArray(exclusions) ? exclusions : [];
  const plan = planManualReAdd({ exclusions: prev, code });
  if (!plan.cleared) return { ok: true, cleared: false, exclusions: prev };
  try {
    await gateway.writeExclusions(plan.nextExclusions);
    return { ok: true, cleared: true, exclusions: plan.nextExclusions };
  } catch (e) {
    return { ok: false, cleared: false, exclusions: prev, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 截圖重匯：預設略過已排除個股；確認恢復者同步清除標記。 */
export async function applyScreenshotImportWithExclusions<T extends HoldingLike>({
  gateway,
  incoming,
  exclusions,
  confirmedCodes = [],
}: {
  gateway: HoldingPersistenceGateway;
  incoming: T[] | null | undefined;
  exclusions: HoldingExclusion[] | null | undefined;
  confirmedCodes?: unknown[];
}): Promise<{ ok: boolean; accepted: T[]; skipped: string[]; restored: string[]; exclusions: HoldingExclusion[]; error?: string }> {
  const prev = Array.isArray(exclusions) ? exclusions : [];
  const plan = planScreenshotImport({ incoming, exclusions: prev, confirmedCodes });
  if (plan.restored.length === 0) {
    return { ok: true, accepted: plan.accepted, skipped: plan.skipped, restored: [], exclusions: prev };
  }
  try {
    await gateway.writeExclusions(plan.nextExclusions);
    return { ok: true, accepted: plan.accepted, skipped: plan.skipped, restored: plan.restored, exclusions: plan.nextExclusions };
  } catch (e) {
    // 清標記失敗 → 整批不恢復，維持原排除狀態
    const conservative = planScreenshotImport({ incoming, exclusions: prev, confirmedCodes: [] });
    return {
      ok: false,
      accepted: conservative.accepted,
      skipped: conservative.skipped,
      restored: [],
      exclusions: prev,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
