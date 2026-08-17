import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

/**
 * 執行資料庫端 RLS 訂閱能見度測試套件。
 *
 * 套件涵蓋：
 *   - mentor 7 天回溯（含邊界 exactly 7d / 8d）
 *   - advisor 不套用 7 天回溯
 *   - 過期後續訂 → 舊區間 signal 應解鎖
 *   - 空窗期 signal 不可見
 *   - 只有過期訂閱者不可見
 *   - 從未訂閱者不可見
 *
 * 測試在交易內 seed 後 RAISE EXCEPTION 觸發 rollback，不留任何測試資料。
 * 需要 PGHOST 等環境變數；本機或 CI 無 psql/env 則自動 skip。
 */
/**
 * run_rls_subscription_tests() is SECURITY DEFINER owned by postgres and has NO
 * EXECUTE grant for anon/authenticated or for the sandbox read-only role. We do
 * NOT widen the production ACL to make a test pass. The suite therefore runs:
 *   - here, only against a disposable clone (R1P_CLONE_URL, harness role), and
 *   - inside db/r1/p/090_verify_p.sql (T-P99a/b/c) on both fresh clones, where
 *     it executes as the intended owner.
 */
const CLONE_URL = process.env.R1P_CLONE_URL || '';
const canRun = !!CLONE_URL;

describe.skipIf(!canRun)('RLS: subscription visibility (mentor 7d / renew / gap)', () => {
  it('all scenarios pass', () => {
    const out = execSync(
      `psql "${CLONE_URL}" -At -F '|' -c "SELECT test_name, passed, COALESCE(detail,'') FROM public.run_rls_subscription_tests();"`,
      { encoding: 'utf8' },
    );
    const rows = out.trim().split('\n').filter(Boolean).map((line) => {
      const [name, passed, detail] = line.split('|');
      return { name, passed: passed === 't' || passed === 'true', detail };
    });

    expect(rows.length).toBeGreaterThanOrEqual(15);
    const failed = rows.filter((r) => !r.passed);
    if (failed.length) {
      // eslint-disable-next-line no-console
      console.error('Failed RLS subscription cases:\n' + failed.map((f) => `  - ${f.name}: ${f.detail}`).join('\n'));
    }
    expect(failed).toEqual([]);
  });
});
