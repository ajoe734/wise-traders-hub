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
  it('必定走統一 admin 契約（requireCompanyAdmin + authErrorResponse）', () => {
    expect(SRC).toMatch(/from '\.\.\/_shared\/adminGuard\.ts'/);
    expect(SRC).toMatch(/requireCompanyAdmin\(req\)/);
    expect(SRC).toMatch(/authErrorResponse\(/);
  });

  it('admin 驗證發生在分流到 list/single 之前', () => {
    const idx = SRC.search(/requireCompanyAdmin\(req\)/);
    const modeIdx = SRC.search(/mode\s*===\s*'list'/);
    expect(idx).toBeGreaterThan(0);
    expect(modeIdx).toBeGreaterThan(idx);
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

  it('list 模式支援 page / page_size 分頁並回傳 total_pages', () => {
    expect(SRC).toMatch(/page_size/);
    expect(SRC).toMatch(/searchParams\.get\('page'\)/);
    expect(SRC).toMatch(/searchParams\.get\('page_size'\)/);
    expect(SRC).toMatch(/total_pages/);
  });

  it('page_size 必須有最大值上限，避免一次拉太多資料', () => {
    expect(SRC).toMatch(/MAX_PAGE_SIZE\s*=\s*\d+/);
    // 上限不得超過 1000，避免濫用
    const m = SRC.match(/MAX_PAGE_SIZE\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(1000);
    expect(SRC).toMatch(/clamp\(Number\(pageSizeParam[\s\S]*?MAX_PAGE_SIZE\)/);
  });

  it('保留 legacy limit/offset 路徑以維持向後相容', () => {
    expect(SRC).toMatch(/searchParams\.get\('limit'\)/);
    expect(SRC).toMatch(/searchParams\.get\('offset'\)/);
  });
});
