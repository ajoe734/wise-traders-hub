/**
 * 訂閱者到期提醒 dedupe 契約（鏡像 DB ledger `subscriber_expiry_reminders`）。
 *
 * 權威實作在 SQL：`UNIQUE (expert_id, local_date, reminder_type)` +
 * `claim_subscriber_expiry_reminders()` 的 `INSERT ... ON CONFLICT DO NOTHING`，
 * `deduped = due_experts - claimed`。本檔只以純函式重現同一組 key／計數語意，
 * 供 harness／測試在不觸碰 DB 的情況下驗證「同日同老師一次」。
 * `src/test/unit/subscriber-expiry-dedupe.contract.test.ts` 會對照 SQL 檔確認欄位與常數一致。
 */

export const SUBSCRIBER_EXPIRY_REMINDER_TYPE = 'subscriber_expiry_7d';
export const SUBSCRIBER_EXPIRY_LEDGER_UNIQUE_COLUMNS = ['expert_id', 'local_date', 'reminder_type'] as const;

export interface ReminderLedgerCandidate {
  expert_id: string;
  local_date: string; // YYYY-MM-DD（老師時區）
  reminder_type?: string;
}

/** 與 DB UNIQUE 同序：expert_id + local_date + reminder_type。 */
export function reminderLedgerKey(c: ReminderLedgerCandidate): string {
  return [c.expert_id, c.local_date, c.reminder_type || SUBSCRIBER_EXPIRY_REMINDER_TYPE].join('|');
}

export interface ClaimOutcome<T extends ReminderLedgerCandidate> {
  claimed: T[];
  deduped: number;
  due_experts: number;
}

/**
 * 模擬 `INSERT ... ON CONFLICT (expert_id, local_date, reminder_type) DO NOTHING`：
 * ledger 已有 key → 不再 claim；`deduped = due_experts - claimed.length`。
 * 會就地寫入 `ledger`（等同 ledger row 落地），重跑冪等。
 */
export function claimReminderLedger<T extends ReminderLedgerCandidate>(
  ledger: Set<string>,
  candidates: T[],
): ClaimOutcome<T> {
  const claimed: T[] = [];
  for (const c of candidates) {
    const key = reminderLedgerKey(c);
    if (ledger.has(key)) continue;
    ledger.add(key);
    claimed.push(c);
  }
  return { claimed, deduped: candidates.length - claimed.length, due_experts: candidates.length };
}
