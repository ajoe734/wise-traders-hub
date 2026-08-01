import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * P4 — Fallback 觸發率量化 TDD 契約。
 *
 * 背景：目前前端只能從 lag_days 或 bsr_source='raw_fallback' 推測是否使用 D-1 資料，
 * 無法精確知道某個視窗是否來自 fallback。
 * 修復契約：
 * 1. tw_chips_rollup 必須新增 source_date 與 fallback_used 欄位。
 * 2. 寫入 rollup 時，若是從舊日回溯補齊的視窗，必須標記 fallback_used=true。
 * 3. tw-chips-detail 回傳 bsr_fallback_used 與 bsr_source_date，供前端 5 態機直接判斷。
 * 4. useChipsState 讀取 fallback_used 後，回報 telemetry 與 UI 狀態。
 */

const ROLLUP_FILE = resolve(__dirname, '../../../supabase/functions/_shared/bsrRollup.ts');
const DETAIL_FILE = resolve(__dirname, '../../../supabase/functions/tw-chips-detail/index.ts');
const STATE_FILE = resolve(__dirname, '../../../src/checkup/hooks/useChipsState.ts');
const PAYLOAD_FILE = resolve(__dirname, '../../../src/checkup/lib/chipsRepository.ts');

function load(p: string) {
  return readFileSync(p, 'utf-8');
}

describe('P4-A: tw_chips_rollup schema與回填契約', () => {
  it('migration 已新增 source_date 與 fallback_used 到 tw_chips_rollup', () => {
    const MIGRATIONS_DIR = resolve(__dirname, '../../../supabase/migrations');
    const { readdirSync } = require('fs');
    const files = readdirSync(MIGRATIONS_DIR).sort();
    const latest = files
      .map((f: string) => readFileSync(resolve(MIGRATIONS_DIR, f), 'utf-8'))
      .join('\n');
    expect(latest).toMatch(/tw_chips_rollup[\s\S]*?source_date/i);
    expect(latest).toMatch(/tw_chips_rollup[\s\S]*?fallback_used/i);
  });

  it('rollup 重建程式碼會設定 source_date 與 fallback_used', () => {
    const rollup = load(ROLLUP_FILE);
    expect(rollup).toMatch(/source_date\s*:/i);
    expect(rollup).toMatch(/fallback_used\s*:/i);
  });
});

describe('P4-B: tw-chips-detail fallback 回傳契約', () => {
  it('payload 中必須回傳 bsr_source_date 與 bsr_fallback_used', () => {
    const detail = load(DETAIL_FILE);
    expect(detail).toMatch(/bsr_source_date\s*:/i);
    expect(detail).toMatch(/bsr_fallback_used\s*:/i);
  });

  it('前端 TypeScript interface 必須包含 bsr_source_date 與 bsr_fallback_used', () => {
    const payload = load(PAYLOAD_FILE);
    expect(payload).toMatch(/bsr_source_date\?:/i);
    expect(payload).toMatch(/bsr_fallback_used\?:/i);
  });
});

describe('P4-C: useChipsState 使用 fallback_used 判定 D1', () => {
  it('deriveChipsState 直接引用 fallback_used 來標記 D1 fallback', () => {
    const state = load(STATE_FILE);
    expect(state).toMatch(/fallback_used/i);
  });

  it('chips_state_resolved telemetry 必須包含 fallback_used 欄位', () => {
    const state = load(STATE_FILE);
    expect(state).toMatch(/fallback_used\s*:/i);
  });
});
