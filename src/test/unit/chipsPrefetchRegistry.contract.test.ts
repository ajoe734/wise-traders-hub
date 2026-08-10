/**
 * Contract test: chips_prefetch_targets(demo_seed) ↔ src/checkup/seedData.js INIT_HOLDINGS
 *
 * 技術債（明列）：registry 目前只有 server 端消費（背景 cron 的 universe）。
 * 前端 Demo 清單仍是 INIT_HOLDINGS 常數，屬第二資料源。此測試是唯一的鎖：
 * 只要兩邊代號不同步就 fail，避免背景預抓漏掉 Demo 會看到的股票。
 * 若日後把 Demo 清單改成從 registry 讀，這個測試連同 SEEDED_DEMO_CODES 一起刪除。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * migration 20260810 seed 進 chips_prefetch_targets 的 demo_seed 代號。
 * 修改 INIT_HOLDINGS 時，必須同步這裡 **並** 補一筆 migration。
 */
export const SEEDED_DEMO_CODES = [
  '00637L', '039108', '053848', '702157', '1503', '1717', '2308', '2313',
  '2543', '3006', '3013', '3017', '3231', '3443', '3491', '4583',
  '6274', '6770', '6862', '8227',
];

function readInitHoldingCodes(): string[] {
  const file = path.resolve(process.cwd(), 'src/checkup/seedData.js');
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('export const INIT_HOLDINGS = [');
  expect(start, 'INIT_HOLDINGS not found in seedData.js').toBeGreaterThan(-1);
  const after = src.slice(start + 1);
  const nextExport = after.indexOf('\nexport const ');
  const seg = nextExport === -1 ? after : after.slice(0, nextExport);
  return [...seg.matchAll(/code:\s*'([^']+)'/g)].map((m) => m[1]);
}

describe('chips prefetch registry ↔ INIT_HOLDINGS contract', () => {
  it('registry seed 覆蓋 INIT_HOLDINGS 的每一檔（未同步就 fail）', () => {
    const init = readInitHoldingCodes();
    expect(init.length).toBeGreaterThan(0);
    expect([...new Set(init)].sort()).toEqual([...new Set(SEEDED_DEMO_CODES)].sort());
  });

  it('registry seed 沒有重複代號', () => {
    expect(new Set(SEEDED_DEMO_CODES).size).toBe(SEEDED_DEMO_CODES.length);
  });

  it('只有 ^[1-9]\\d{3}$ 會進 FinMind BSR queue，其餘標記 unsupported', () => {
    const supported = SEEDED_DEMO_CODES.filter((c) => /^[1-9]\d{3}$/.test(c));
    const unsupported = SEEDED_DEMO_CODES.filter((c) => !/^[1-9]\d{3}$/.test(c));
    expect(supported).toHaveLength(16);
    // ETF（00637L）與權證（039108 / 053848 / 702157）
    expect(unsupported.sort()).toEqual(['00637L', '039108', '053848', '702157']);
  });
});
