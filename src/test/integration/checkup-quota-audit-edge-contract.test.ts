/**
 * checkup-quota-audit edge function 結構合約測試。
 * 守住：
 *  1. 一律先驗 JWT
 *  2. 一律驗 has_role(company_admin) — 包含 list 模式
 *  3. 每次查詢都寫入 audit_logs（action='checkup_quota.audit_query'）
 *  4. list 模式接受 tier / reason / date_from / date_to 篩選
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = readFileSync(
  resolve(__dirname, '../../../supabase/functions/checkup-quota-audit/index.ts'),
  'utf-8',
);

describe('checkup-quota-audit edge function — 安全/稽核合約', () => {
  it('必定驗證 Authorization Bearer token', () => {
    expect(SRC).toMatch(/Authorization[^\n]*Bearer/);
    expect(SRC).toMatch(/AUTH_REQUIRED/);
    expect(SRC).toMatch(/AUTH_FAILED/);
  });

  it('必定呼叫 has_role 驗 company_admin（在分流到 list/single 之前）', () => {
    const idx = SRC.indexOf("'company_admin'");
    const modeIdx = SRC.search(/mode\s*===\s*'list'/);
    expect(idx).toBeGreaterThan(0);
    expect(modeIdx).toBeGreaterThan(idx);
    expect(SRC).toMatch(/FORBIDDEN/);
  });

  it('每次呼叫都寫入 audit_logs（action=checkup_quota.audit_query）', () => {
    expect(SRC).toMatch(/writeAuditLog/);
    expect(SRC).toMatch(/'checkup_quota\.audit_query'/);
    expect(SRC).toMatch(/rest\/v1\/audit_logs/);
    expect(SRC).toMatch(/target_type:\s*'checkup_quota_audit'/);
  });

  it('audit_logs 寫入單筆 user_id 時必須驗 UUID 格式（防止亂塞 target_id）', () => {
    expect(SRC).toMatch(/\/\^\[0-9a-f-\]\{36\}\$\/i\.test/);
  });

  it('list 模式支援 tier / reason / date_from / date_to 篩選', () => {
    expect(SRC).toMatch(/searchParams\.get\('tier'\)/);
    expect(SRC).toMatch(/searchParams\.get\('reason'\)/);
    expect(SRC).toMatch(/searchParams\.get\('date_from'\)/);
    expect(SRC).toMatch(/searchParams\.get\('date_to'\)/);
  });

  it('inferReason 必須區分 tester / subscription / line_free_gift / none', () => {
    expect(SRC).toMatch(/is_tester[\s\S]*?return 'tester'/);
    expect(SRC).toMatch(/return `subscription:/);
    expect(SRC).toMatch(/line_user_id[\s\S]*?return 'line_free_gift'/);
    expect(SRC).toMatch(/return 'none'/);
  });
});
