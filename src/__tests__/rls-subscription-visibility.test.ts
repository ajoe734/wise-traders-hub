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
const SQL = `SELECT test_name, passed, COALESCE(detail,'') FROM public.run_rls_subscription_tests();`;

/**
 * 需要能 EXECUTE run_rls_subscription_tests 的 DB 角色。
 * 沙箱／本機 psql 是受限角色（無 EXECUTE），視為「環境不具備」而 skip，
 * 不把環境限制報成產品缺陷；CI 以 service 角色跑時會真的執行。
 */
function probe(): { ok: boolean; out?: string } {
  if (!process.env.PGHOST) return { ok: false };
  try {
    return { ok: true, out: execSync(`psql -At -F '|' -c "${SQL}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    const msg = String((e as { stderr?: Buffer })?.stderr ?? e);
    if (/permission denied for function/i.test(msg)) return { ok: false };
    throw e;
  }
}

const probed = probe();
const canRun = probed.ok;

describe.skipIf(!canRun)('RLS: subscription visibility (mentor 7d / renew / gap)', () => {
  it('all scenarios pass', () => {
    const out = probed.out as string;

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
