/**
 * 合約測試：補償權益 (checkup_entitlements) + check_checkup_quota v5
 * 驗證舊會員回送額度不會被 line_free 1/1 鎖死。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SQL = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/20260606131609_a8252bc8-8f3e-4bf4-bef7-425762ce9b5c.sql'),
  'utf-8',
);

describe('checkup_entitlements + quota v5 合約', () => {
  it('checkup_entitlements 表存在，含必要欄位', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.checkup_entitlements/);
    for (const col of ['user_id', 'amount', 'reason', 'expires_at', 'is_active']) {
      expect(SQL).toContain(col);
    }
  });

  it('GRANT SELECT 給 authenticated（避免 PostgREST 403）', () => {
    expect(SQL).toMatch(/GRANT SELECT ON public\.checkup_entitlements TO authenticated/);
    expect(SQL).toMatch(/GRANT ALL\s+ON public\.checkup_entitlements TO service_role/);
  });

  it('RLS：使用者只能讀自己；admin 全權', () => {
    expect(SQL).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(SQL).toMatch(/users view own entitlements[\s\S]+?user_id = auth\.uid\(\)/);
    expect(SQL).toMatch(/admins full access entitlements[\s\S]+?has_role\(auth\.uid\(\), 'company_admin'/);
  });

  it('check_checkup_quota 必須將補償加總進 total_limit', () => {
    expect(SQL).toMatch(/v_total_limit\s*:=\s*v_base_limit\s*\+\s*v_entitlement_total/);
    expect(SQL).toMatch(/'limit',\s*v_total_limit/);
    expect(SQL).toMatch(/'base_limit',\s*v_base_limit/);
    expect(SQL).toMatch(/'entitlement_total',\s*v_entitlement_total/);
  });

  it('補償權益 SUM 必須過濾 is_active 與未過期', () => {
    expect(SQL).toMatch(/SUM\(amount\)[\s\S]+?FROM public\.checkup_entitlements[\s\S]+?is_active = true[\s\S]+?expires_at IS NULL OR expires_at > now\(\)/);
  });

  it('回送一次性 seed：對所有 LINE 帳號 grant legacy_apology_2026_06', () => {
    expect(SQL).toMatch(/INSERT INTO public\.checkup_entitlements[\s\S]+?'legacy_apology_2026_06'/);
    expect(SQL).toMatch(/NOT EXISTS[\s\S]+?reason = 'legacy_apology_2026_06'/);
  });

  it('SECURITY DEFINER + search_path 仍保留', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.check_checkup_quota[\s\S]+?SECURITY DEFINER[\s\S]+?SET search_path = public/);
  });
});
