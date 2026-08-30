/**
 * SECURITY_ACCESS_FIX REV2 — item 3 的靜態合約。
 *
 * 這支 migration 是「把 live DB 已手動修好的狀態 formalize 成可重入檔案」，
 * 因此紅線不是「有沒有寫 SQL」，而是四條禁令：
 *   1. 不得建立 definer metadata view
 *   2. 不得改 payment_providers_safe 的 security_invoker（會壞掉 anon 結帳）
 *   3. 不得 REVOKE service_role（不重設既有後端權限）
 *   4. 不得觸碰 pg_cron（不把已停用的 8 個 job 改回）
 * 外加：必須可重入（重複套用不報錯）。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const FILE = 'db/pending/20260830092000_security_access_hardening.sql';
const sql = fs.readFileSync(FILE, 'utf8');
/** 去掉 `--` 註解後的可執行 SQL，避免註解文字造成偽陽性。 */
const exec = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('security access hardening migration (REV2)', () => {
  it('不建立任何 definer metadata view', () => {
    expect(exec).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?VIEW/i);
    expect(exec).not.toContain('expert_limit_up_hits_public');
    expect(exec).not.toContain('checkup_knowledge_items_public');
  });

  it('不改 payment_providers_safe 的 security_invoker', () => {
    expect(exec).not.toMatch(/ALTER\s+VIEW[^;]*payment_providers_safe[^;]*security_invoker/i);
    // 例外理由必須寫在檔案裡，供 scanner / 稽核追溯
    expect(sql).toMatch(/scanner exception/i);
    expect(sql).toContain('Company admins full access providers');
  });

  it('不含任何 REVOKE ... FROM service_role', () => {
    const revokes = exec.match(/REVOKE[^;]*;/gi) ?? [];
    expect(revokes.length).toBeGreaterThan(0);
    for (const r of revokes) expect(r).not.toMatch(/service_role/i);
  });

  it('不觸碰 pg_cron（已停用的 8 個 job 不得被改回）', () => {
    expect(exec).not.toMatch(/cron\.(schedule|unschedule|alter_job)/i);
    expect(exec).not.toMatch(/\bactive\s*=>\s*true/i);
  });

  it('可重入：每個 CREATE POLICY 前都有對應的 DROP POLICY IF EXISTS', () => {
    const created = [...exec.matchAll(/CREATE POLICY "([^"]+)"/g)].map((m) => m[1]);
    expect(created.length).toBeGreaterThan(0);
    for (const name of created) {
      expect(exec).toContain(`DROP POLICY IF EXISTS "${name}"`);
      expect(exec.indexOf(`DROP POLICY IF EXISTS "${name}"`)).toBeLessThan(exec.indexOf(`CREATE POLICY "${name}"`));
    }
    // 舊的 open policy 必須被移除
    expect(exec).toContain('DROP POLICY IF EXISTS "Anyone can view limit up hits"');
    expect(exec).toContain('DROP POLICY IF EXISTS "Anyone can read knowledge items"');
  });

  it('可重入：函式一律 CREATE OR REPLACE，且 search_path 釘死', () => {
    const defs = exec.match(/CREATE\s+FUNCTION/gi) ?? [];
    expect(defs.length).toBe(0);
    const replaces = exec.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g) ?? [];
    expect(replaces.length).toBeGreaterThanOrEqual(2);
    for (const fn of ['has_active_checkup_access', 'ensure_bsr_queued']) {
      const at = exec.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}`);
      expect(at).toBeGreaterThan(-1);
      expect(exec.slice(at, at + 400)).toMatch(/SET search_path/i);
      expect(exec.slice(at, at + 400)).toMatch(/SECURITY DEFINER/i);
    }
  });

  it('anon 讀取面收斂：兩張敏感表都撤 anon SELECT 並保留 service_role', () => {
    for (const t of ['expert_limit_up_hits', 'checkup_knowledge_items']) {
      expect(exec).toContain(`REVOKE SELECT ON public.${t} FROM anon;`);
      expect(exec).toContain(`GRANT ALL ON public.${t} TO service_role;`);
      expect(exec).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
    }
  });

  it('ensure_bsr_queued 具匿名 uid guard 且不 raise（維持 jsonb 形狀）', () => {
    const at = exec.indexOf('CREATE OR REPLACE FUNCTION public.ensure_bsr_queued');
    const head = exec.slice(at, at + 1600);
    expect(head).toContain('auth.uid() IS NULL');
    expect(head).toContain("'skipped', 'unauthenticated'");
    expect(head).toContain("'status', 'ineligible'");
    expect(head).not.toMatch(/RAISE EXCEPTION/i);
  });

  it('SD 函式收斂涵蓋所有仍對 anon 開放的排程專用函式', () => {
    for (const fn of [
      'enqueue_institutional_backfill_universe()',
      'enqueue_all_active_tw_holdings_bsr(integer)',
      'enqueue_institutional_new_stock(text)',
      'enqueue_backfill_jobs(jsonb)',
      'claim_backfill_jobs(integer, integer)',
      'claim_institutional_new_stock(integer)',
      'bsr_snapshot_claim(date, uuid, integer)',
      'finmind_admit(text, text, text, integer)',
      'finmind_admit_v2(text, text, text, numeric, boolean)',
    ]) {
      expect(exec).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`);
      expect(exec).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role;`);
    }
    for (const fn of [
      'admin_apply_fix_proposal(uuid, boolean)',
      'admin_generate_fix_proposals(text)',
      'enqueue_bsr_backfill(text, integer)',
    ]) {
      expect(exec).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM PUBLIC, anon;`);
      expect(exec).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated, service_role;`);
    }
  });

  it('鎖等待有界（避免長交易卡住 production）', () => {
    expect(exec).toContain("SET lock_timeout = '5s';");
    expect(exec).toContain("SET statement_timeout = '120s';");
  });
});
