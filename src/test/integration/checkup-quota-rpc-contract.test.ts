/**
 * Checkup quota RPC 合約測試 — 驗證 check_checkup_quota 的 SQL 定義
 * 涵蓋：line_free / none / lifetime period / last_used_at 欄位回傳。
 * 對應 migration: 20260603030329_7c030f91-f1f7-4bc4-b35a-339f85341987.sql
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../supabase/migrations/20260603030329_7c030f91-f1f7-4bc4-b35a-339f85341987.sql',
);
const SQL = readFileSync(MIGRATION_PATH, 'utf-8');

describe('check_checkup_quota — SQL 合約', () => {
  it('函數定義存在且為 SECURITY DEFINER', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.check_checkup_quota/);
    expect(SQL).toMatch(/SECURITY DEFINER/);
    expect(SQL).toMatch(/SET search_path = public/);
  });

  it('回傳 jsonb 必含 tier/period/limit/used/remaining/resets_at/last_used_at 七個欄位', () => {
    for (const k of ['tier', 'period', 'limit', 'used', 'remaining', 'resets_at', 'last_used_at']) {
      expect(SQL).toContain(`'${k}',`);
    }
  });

  it('line_%@line.local 用戶 → tier=line_free / period=lifetime / limit=1', () => {
    expect(SQL).toMatch(/email\s+LIKE\s+'line_%@line\.local'/);
    expect(SQL).toMatch(/v_tier\s*:=\s*'line_free'/);
    expect(SQL).toMatch(/v_period\s*:=\s*'lifetime'/);
    // limit=1 出現在 line_free 分支
    const lineBranch = SQL.split('line_free')[1] || '';
    expect(lineBranch).toMatch(/v_limit\s*:=\s*1/);
  });

  it('非 LINE 用戶 + 無訂閱 → tier=none / limit=0（必須付費訂閱）', () => {
    expect(SQL).toMatch(/v_tier\s*:=\s*'none'/);
    const noneBranch = SQL.split("v_tier := 'none'")[1] || '';
    expect(noneBranch).toMatch(/v_limit\s*:=\s*0/);
  });

  it('period=lifetime → period_start=epoch、resets_at=infinity', () => {
    expect(SQL).toMatch(/'epoch'::timestamptz/);
    expect(SQL).toMatch(/'infinity'::timestamptz/);
  });

  it('last_used_at 來自 MAX(used_at) 且受 period_start 過濾', () => {
    expect(SQL).toMatch(/MAX\(used_at\)/);
    expect(SQL).toMatch(/INTO\s+v_used,\s*v_last_used_at/);
    expect(SQL).toMatch(/used_at\s*>=\s*v_period_start/);
  });

  it('limit=0 時 last_used_at 必須回 NULL（不查 usage 表）', () => {
    // ELSE 分支應顯式設 NULL
    expect(SQL).toMatch(/v_last_used_at\s*:=\s*NULL/);
  });

  it('tester（is_tester=true）→ tier=pro / limit=22', () => {
    expect(SQL).toMatch(/v_is_tester/);
    const testerBranch = SQL.split('IF v_is_tester THEN')[1]?.split('ELSE')[0] || '';
    expect(testerBranch).toMatch(/v_tier\s*:=\s*'pro'/);
    expect(testerBranch).toMatch(/v_limit\s*:=\s*22/);
  });
});
