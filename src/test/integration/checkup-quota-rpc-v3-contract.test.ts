/**
 * check_checkup_quota v3 容錯合約測試 — 對應 20260603041534 migration
 * 新增：EXCEPTION 兜底 + COALESCE 防 NULL + last_used_at key 永遠存在。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SQL = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/20260603041534_800d75e1-ca23-47e6-bf13-3b1466cdaac9.sql'),
  'utf-8',
);

describe('check_checkup_quota v3 — 容錯合約', () => {
  it('保留 SECURITY DEFINER + search_path', () => {
    expect(SQL).toMatch(/SECURITY DEFINER/);
    expect(SQL).toMatch(/SET search_path = public/);
  });

  it('usage 查詢必須包在 BEGIN...EXCEPTION WHEN OTHERS 區塊（避免壞資料阻塞 RPC）', () => {
    expect(SQL).toMatch(/BEGIN[\s\S]+?FROM public\.checkup_usage[\s\S]+?EXCEPTION\s+WHEN\s+OTHERS\s+THEN/i);
  });

  it('EXCEPTION 分支必須把 v_last_used_at 重設為 NULL', () => {
    const exBlock = SQL.split(/EXCEPTION\s+WHEN\s+OTHERS\s+THEN/i)[1] || '';
    expect(exBlock).toMatch(/v_last_used_at\s*:=\s*NULL/);
    expect(exBlock).toMatch(/v_used\s*:=\s*0/);
  });

  it('used / remaining 必須用 COALESCE 包裹防 NULL', () => {
    expect(SQL).toMatch(/COALESCE\(v_used,\s*0\)/);
    expect(SQL).toMatch(/GREATEST\(v_limit\s*-\s*COALESCE\(v_used,\s*0\),\s*0\)/);
  });

  it('回傳 jsonb 必須包含 last_used_at key（即使值為 NULL）', () => {
    expect(SQL).toMatch(/'last_used_at',\s*v_last_used_at/);
  });

  it('v_last_used_at 變數初始化為 NULL', () => {
    expect(SQL).toMatch(/v_last_used_at\s+timestamptz\s*:=\s*NULL/);
  });

  it('GRANT EXECUTE 給 authenticated + service_role', () => {
    expect(SQL).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.check_checkup_quota\(uuid\)\s+TO\s+authenticated,\s*service_role/i);
  });
});
