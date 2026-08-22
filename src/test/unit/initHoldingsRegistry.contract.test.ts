/**
 * Stage 0 RED test — INIT_HOLDINGS 只能有一個權威清單。
 *
 * 前端 demo 種子 `src/checkup/seedData.js` 的 INIT_HOLDINGS，必須與 server-side
 * registry 種子（migration 20260810060708 對 `public.chips_prefetch_targets`
 * 的唯一一段 INSERT）逐字一致。20 個代號不得再出現第三個硬編碼副本。
 *
 * 分類（16 supported / 4 unsupported）由 `public.tw_bsr_eligibility()` 決定，
 * 驗證放在 `supabase/tests/init_holdings_registry_contract_test.sql`。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SEED_TS = 'src/checkup/seedData.js';
const SEED_SQL = 'supabase/migrations/20260810060708_ba8b1818-1955-4264-9d54-d39b605c651d.sql';

function initHoldingCodes(): string[] {
  const src = fs.readFileSync(path.resolve(SEED_TS), 'utf8');
  const block = src.slice(src.indexOf('INIT_HOLDINGS'));
  const end = block.indexOf('\n]');
  const codes = [...block.slice(0, end).matchAll(/code:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  return codes;
}

function registrySeedCodes(): string[] {
  const sql = fs.readFileSync(path.resolve(SEED_SQL), 'utf8');
  const i = sql.indexOf('INSERT INTO public.chips_prefetch_targets');
  const block = sql.slice(i, sql.indexOf(';', i));
  const values = block.slice(block.indexOf('FROM (VALUES'));
  return [...values.matchAll(/\('([^']+)'\)/g)].map((m) => m[1]);
}

describe('INIT_HOLDINGS ↔ chips_prefetch_targets registry seed', () => {
  it('前端種子恰好 20 檔', () => {
    expect(initHoldingCodes()).toHaveLength(20);
  });

  it('registry 種子恰好 20 檔', () => {
    expect(registrySeedCodes()).toHaveLength(20);
  });

  it('兩份清單集合完全相同（server-side registry 為權威）', () => {
    const a = [...initHoldingCodes()].sort();
    const b = [...registrySeedCodes()].sort();
    expect(a).toEqual(b);
  });

  it('4 檔非普通台股不得符合 ^[1-9]\\d{3}$（BSR 只收普通台股）', () => {
    const plain = registrySeedCodes().filter((c) => /^[1-9]\d{3}$/.test(c));
    expect(plain).toHaveLength(16);
    expect(registrySeedCodes().length - plain.length).toBe(4);
  });
});
