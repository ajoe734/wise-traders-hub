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
 *
 * 另提供 buildSellTradeEntry：「刪除前先記一筆賣出」的純函式層。
 * 產出的交易列與 TradeTab.applyCorrections 同形狀，由呼叫端走既有
 * mergeTradeIntoHoldings + setTradeLog 管線；本服務不做任何提交。
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
import { formatTradeDate, formatTradeTime } from './manualTradeEntry';

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

// ── 「記賣出並刪除」純函式層 ──────────────────────────────────────────

export type SellEntryError = 'invalid-qty' | 'invalid-price' | 'oversell';

/**
 * 賣出交易列：欄位與 TradeTab.applyCorrections 產生的列同形狀
 * （12-key manual row + tradeLog 的 id / qa），mergeTradeIntoHoldings
 * 只讀 action / code / name / qty / price / total_cost / fee / market_price。
 */
export interface SellTradeEntry {
  id: string;
  action: '賣出';
  code: string;
  name: string;
  qty: number;
  price: number;
  market_price: null;
  amount: null;
  total_cost: null;
  fee: null;
  date: string;
  time: string;
  priceSource: 'manual';
  qa: [];
}

export function validateSellEntry({
  qty,
  price,
  heldQty,
}: {
  qty: number;
  price: number;
  heldQty: number;
}): SellEntryError | null {
  if (!Number.isFinite(qty) || qty <= 0) return 'invalid-qty';
  if (!Number.isFinite(price) || price <= 0) return 'invalid-price';
  if (Number.isFinite(heldQty) && heldQty > 0 && qty > heldQty) return 'oversell';
  return null;
}

export type BuildSellEntryResult =
  | { ok: true; entry: SellTradeEntry }
  | { ok: false; error: SellEntryError | 'invalid-code' };

/** 賣出股數 = 持股股數 → replay 後該檔移出持倉；部分賣出 → 僅扣股數。 */
export function buildSellTradeEntry({
  code,
  name,
  qty,
  price,
  heldQty,
  now = new Date(),
}: {
  code: unknown;
  name?: unknown;
  qty: unknown;
  price: unknown;
  heldQty?: unknown;
  now?: Date;
}): BuildSellEntryResult {
  const target = String(code ?? '').trim();
  const q = Number(qty);
  const p = Number(price);
  const error = validateSellEntry({ qty: q, price: p, heldQty: Number(heldQty) || 0 });
  if (!target) return { ok: false, error: error ?? 'invalid-code' };
  if (error) return { ok: false, error };
  return {
    ok: true,
    entry: {
      id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      action: '賣出',
      code: target,
      name: String(name ?? '').trim() || target,
      qty: q,
      price: p,
      market_price: null,
      amount: null,
      total_cost: null,
      fee: null,
      date: formatTradeDate(now),
      time: formatTradeTime(now),
      priceSource: 'manual',
      qa: [],
    },
  };
}
