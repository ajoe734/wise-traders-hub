/**
 * dedupe 鏡像契約：src/lib/subscriberExpiryDedupe.ts 必須與 SQL ledger 定義一致。
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  SUBSCRIBER_EXPIRY_LEDGER_UNIQUE_COLUMNS,
  SUBSCRIBER_EXPIRY_REMINDER_TYPE,
  claimReminderLedger,
  reminderLedgerKey,
} from '@/lib/subscriberExpiryDedupe';

const sql = readFileSync('db/subscriber-expiry/001_subscriber_expiry_teacher_reminder.sql', 'utf8');

describe('subscriberExpiryDedupe ↔ SQL parity', () => {
  it('UNIQUE 欄位與 reminder_type 預設與 SQL 一致', () => {
    const cols = SUBSCRIBER_EXPIRY_LEDGER_UNIQUE_COLUMNS.join(', ');
    expect(sql).toContain(`UNIQUE (${cols})`);
    expect(sql).toContain(`ON CONFLICT (${cols}) DO NOTHING`);
    expect(sql).toContain(`reminder_type text NOT NULL DEFAULT '${SUBSCRIBER_EXPIRY_REMINDER_TYPE}'`);
  });

  it('同 key 第二次 claim → deduped=1，重跑冪等', () => {
    const ledger = new Set<string>();
    const c = [{ expert_id: 'e1', local_date: '2026-09-11' }];
    expect(claimReminderLedger(ledger, c)).toMatchObject({ deduped: 0, due_experts: 1 });
    expect(claimReminderLedger(ledger, c)).toMatchObject({ claimed: [], deduped: 1, due_experts: 1 });
    expect(reminderLedgerKey(c[0])).toBe('e1|2026-09-11|subscriber_expiry_7d');
  });

  it('不同 local_date 或不同老師不互相 dedupe', () => {
    const ledger = new Set<string>();
    claimReminderLedger(ledger, [{ expert_id: 'e1', local_date: '2026-09-11' }]);
    const r = claimReminderLedger(ledger, [
      { expert_id: 'e1', local_date: '2026-09-12' },
      { expert_id: 'e2', local_date: '2026-09-11' },
    ]);
    expect(r.claimed).toHaveLength(2);
    expect(r.deduped).toBe(0);
  });
});
