/**
 * consume_checkup_quota v4 容錯合約測試 — 對應 20260603055847 migration。
 * v4 新增：BEGIN/EXCEPTION 包覆 check_checkup_quota、COALESCE 防 NULL、
 *         回傳同步更新 last_used_at 為 now()。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SQL = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/20260603055847_14f57a0e-86ae-466a-ae11-66977312fbc8.sql'),
  'utf-8',
);

describe('consume_checkup_quota v4 — 容錯合約', () => {
  it('保留 SECURITY DEFINER 與 search_path', () => {
    expect(SQL).toMatch(/SECURITY DEFINER/);
    expect(SQL).toMatch(/SET search_path = public/);
  });

  it('檢查階段必須包在 BEGIN...EXCEPTION 區塊（避免 check_checkup_quota 異常時整個扣次中斷）', () => {
    expect(SQL).toMatch(/BEGIN[\s\S]+?check_checkup_quota[\s\S]+?EXCEPTION\s+WHEN\s+OTHERS\s+THEN/i);
  });

  it('check 異常時 RAISE QUOTA_CHECK_FAILED', () => {
    expect(SQL).toMatch(/RAISE\s+EXCEPTION\s+'QUOTA_CHECK_FAILED'/);
  });

  it('used / remaining 必須用 COALESCE 防 NULL', () => {
    expect(SQL).toMatch(/COALESCE\(\(v_q->>'remaining'\)::int,\s*0\)/);
    expect(SQL).toMatch(/COALESCE\(\(v_q->>'used'\)::int,\s*0\)/);
  });

  it('回傳必須蓋寫 last_used_at 為當下 now()', () => {
    expect(SQL).toMatch(/v_now\s+timestamptz\s*:=\s*now\(\)/);
    expect(SQL).toMatch(/'last_used_at',\s*v_now/);
  });

  it('保留配額用罄時 RAISE QUOTA_EXCEEDED', () => {
    expect(SQL).toMatch(/RAISE\s+EXCEPTION\s+'QUOTA_EXCEEDED'/);
  });

  it('保留 advisory lock 防競態', () => {
    expect(SQL).toMatch(/pg_advisory_xact_lock\(hashtext\('checkup_quota:'/);
  });

  it('GRANT EXECUTE 給 authenticated + service_role', () => {
    expect(SQL).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.consume_checkup_quota\(uuid,\s*text\)\s+TO\s+authenticated,\s*service_role/i);
  });
});
