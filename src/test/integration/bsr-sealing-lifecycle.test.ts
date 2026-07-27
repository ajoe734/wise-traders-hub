import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

/**
 * P3 — Sealing 機制 TDD 契約測試。
 *
 * 背景：tw_bsr_daily_snapshot_status 目前 0 筆，前端無法判斷 BSR 資料是否已封存。
 * 修復契約：
 * 1. bsr_snapshot_mark 在 status='ready' 且尚未封存時，必須寫入 sealed_at 與 sealed_by_lane。
 * 2. tw-chips-detail 回傳 readiness.sealed 與 sealed_at，供前端 5 態機直接判斷。
 * 3. enforce_snapshot_immutability trigger 存在且會阻止 sealed 後的 UPDATE。
 */

const MIGRATIONS_DIR = resolve(__dirname, '../../../supabase/migrations');
const files = readdirSync(MIGRATIONS_DIR).sort();

function findLatestMigrationContaining(needle: RegExp): string {
  for (let i = files.length - 1; i >= 0; i--) {
    const p = resolve(MIGRATIONS_DIR, files[i]);
    const sql = readFileSync(p, 'utf-8');
    if (needle.test(sql)) return sql;
  }
  throw new Error(`no migration matches ${needle}`);
}

const MARK_SQL = findLatestMigrationContaining(
  /CREATE OR REPLACE FUNCTION public\.bsr_snapshot_mark/i,
);
const IMMUTABILITY_SQL = findLatestMigrationContaining(
  /enforce_snapshot_immutability/i,
);

describe('P3-A: bsr_snapshot_mark 封存契約', () => {
  it('bsr_snapshot_mark 接受 sealed_by_lane 參數', () => {
    expect(MARK_SQL).toMatch(/_sealed_by_lane\s+(text|character varying)/i);
  });

  it('status 轉 ready 且尚未封存時，必須寫入 sealed_at 與 sealed_by_lane', () => {
    // 接受兩種寫法：sealed_at = now() 或 sealed_at = COALESCE(..., now())
    const hasDirect = /sealed_at\s*=\s*(?:now\(\)|CURRENT_TIMESTAMP)/i.test(MARK_SQL);
    const hasProtected = /sealed_at\s*=\s*COALESCE\s*\(/i.test(MARK_SQL);
    expect(hasDirect || hasProtected).toBe(true);
    expect(MARK_SQL).toMatch(/sealed_by_lane\s*=/i);
  });

  it('已封存後不可被同樣 status=ready 再次重置（COALESCE 或 WHERE 條件）', () => {
    // 確保 sealed_at 不是每次都被覆寫：應有 COALESCE(public.tw_bsr_daily_snapshot_status.sealed_at, ...) 或 WHERE 條件
    const hasCoalesce = /COALESCE\s*\(\s*(?:public\.)?tw_bsr_daily_snapshot_status\.sealed_at/i.test(MARK_SQL);
    const hasGuard = /WHERE\s+(?:public\.)?tw_bsr_daily_snapshot_status\.sealed_at\s+IS\s+NULL/i.test(MARK_SQL);
    expect(hasCoalesce || hasGuard).toBe(true);
  });
});

describe('P3-B: snapshot immutability trigger 契約', () => {
  it('enforce_snapshot_immutability trigger 存在於 tw_bsr_daily', () => {
    expect(IMMUTABILITY_SQL).toMatch(/CREATE\s+TRIGGER\s+enforce_snapshot_immutability/i);
    expect(IMMUTABILITY_SQL).toMatch(/tw_bsr_daily/i);
  });

  it('trigger 在 sealed_at 不為 NULL 時拒絕 UPDATE', () => {
    expect(IMMUTABILITY_SQL).toMatch(/tw_bsr_daily_snapshot_status\.sealed_at/i);
    expect(IMMUTABILITY_SQL).toMatch(/(?:RAISE|reject|deny|cannot)/i);
  });
});

describe('P3-C: tw-chips-detail payload 契約', () => {
  it('readiness 內必須包含 sealed 與 sealed_at 欄位', () => {
    const DETAIL_PATH = resolve(
      __dirname,
      '../../../supabase/functions/tw-chips-detail/index.ts',
    );
    const detail = readFileSync(DETAIL_PATH, 'utf-8');
    expect(detail).toMatch(/readiness\s*:\s*\{[\s\S]*?sealed\s*:/i);
    expect(detail).toMatch(/sealed_at\s*:/i);
  });

  it('readiness.sealed 的判定必須讀取自 snapshot_status.sealed_at', () => {
    const DETAIL_PATH = resolve(
      __dirname,
      '../../../supabase/functions/tw-chips-detail/index.ts',
    );
    const detail = readFileSync(DETAIL_PATH, 'utf-8');
    expect(detail).toMatch(/tw_bsr_daily_snapshot_status\b[\s\S]*?sealed_at/i);
  });
});

describe('P3-D: useChipsState 封存判定契約', () => {
  it('readiness.sealed=true 且資料齊全時，state 應為 ready', () => {
    const STATE_PATH = resolve(__dirname, '../../../src/checkup/hooks/useChipsState.ts');
    const state = readFileSync(STATE_PATH, 'utf-8');
    expect(state).toMatch(/readiness\??\.["']?sealed["']?\s*===?\s*true/i);
  });

  it('readiness.sealed=false 且仍有缺料時，不應直接判定為 ready', () => {
    const STATE_PATH = resolve(__dirname, '../../../src/checkup/hooks/useChipsState.ts');
    const state = readFileSync(STATE_PATH, 'utf-8');
    expect(state).toMatch(/fallback_used/i);
  });
});
