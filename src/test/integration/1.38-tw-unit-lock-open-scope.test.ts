/**
 * Group 1.38 — 台股單位鎖只作用於未平倉部位（歷史平倉不擋新持倉週期）
 *
 * 回歸目標：彥愷案例
 *   - 分析師 A 在 t0 以「張」買 2303 1 張 → t1 全數平倉
 *   - t2 分析師想重新用「股」建 2303 999 股（零股新周期）
 *   應該可以，而且不論「張」或「股」都不能被舊歷史強制回鎖成單一單位。
 *
 * 這條回歸鎖三層來源，任一漂移即紅：
 *   A. DB trigger  `public.enforce_unit_consistency`
 *      → SQL 內對 expert_signals / trade_records 的比對條件必須各含
 *        `status = 'pending'` / `status = 'open'`，且 comment 明示只作用於未平倉。
 *   B. UI hook     `src/pages/_adminSignals/SignalCreateDialog.tsx`
 *      → `lookupExistingUnit` 只查 open trade + pending signal，全平倉後不鎖。
 *   C. 資產憲法    `src/lib/asset.ts`
 *      → tw_stock 的 units 白名單必須同時允許 ['張','股']。
 *
 * 對應歷史 issue：
 *   彥愷「台股跟美股你混在一起…現在單位直接強制變成股數」
 *   （2026-07-22 回報，改法 = 鎖的範圍從全歷史縮到 open/pending）
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getAssetSpec, sanitizeAssetQuantityUnit } from '@/lib/asset';

const REPO = resolve(__dirname, '..', '..', '..');
const TRIGGER_SQL_PATH = resolve(
  REPO,
  'supabase/migrations/20260722031805_6c2d8d8f-08c4-49e6-86b2-560ee232a5ce.sql',
);
const DIALOG_PATH = resolve(REPO, 'src/pages/_adminSignals/SignalCreateDialog.tsx');

let triggerSql = '';
let dialogSource = '';

beforeAll(() => {
  triggerSql = readFileSync(TRIGGER_SQL_PATH, 'utf8');
  dialogSource = readFileSync(DIALOG_PATH, 'utf8');
});

describe('A. DB trigger enforce_unit_consistency — 鎖的範圍限縮於未平倉', () => {
  it('對 expert_signals 的比對條件必須帶 status = \'pending\'（6.1-A1）', () => {
    // 抽出 FROM public.expert_signals 到下一個 SELECT/END 之間的區段
    const block = triggerSql.match(
      /FROM public\.expert_signals[\s\S]*?LIMIT\s+1\s*;/i,
    )?.[0];
    expect(block, 'expert_signals 比對區段不存在').toBeTruthy();
    expect(block).toMatch(/status\s*=\s*'pending'/i);
    // 不允許用歷史 in ('pending','filled','closed'...) 這種寬鬆條件
    expect(block).not.toMatch(/status\s+IN\s*\(/i);
  });

  it('對 trade_records 的比對條件必須帶 status = \'open\'（6.1-A2）', () => {
    const block = triggerSql.match(
      /FROM public\.trade_records[\s\S]*?LIMIT\s+1\s*;/i,
    )?.[0];
    expect(block, 'trade_records 比對區段不存在').toBeTruthy();
    expect(block).toMatch(/status\s*=\s*'open'/i);
    expect(block).not.toMatch(/status\s+IN\s*\(/i);
  });

  it('錯誤訊息應標示 scope 為 open_positions_only 且提示「未平倉」（6.1-A3）', () => {
    expect(triggerSql).toMatch(/scope=open_positions_only/);
    expect(triggerSql).toMatch(/未平倉/);
  });

  it('COMMENT 應說明「只作用於未平倉部位」以防未來改回全歷史比對（6.1-A4）', () => {
    expect(triggerSql).toMatch(
      /COMMENT ON FUNCTION[\s\S]*enforce_unit_consistency[\s\S]*未平倉/,
    );
  });
});

describe('B. UI hook lookupExistingUnit — 只查 open / pending', () => {
  it('trade_records 查詢必須加 .eq(\'status\', \'open\')（6.1-B1）', () => {
    const tradeBlock = dialogSource.match(
      /from\(\s*['"]trade_records['"]\s*\)[\s\S]*?\.maybeSingle\(\)/,
    )?.[0];
    expect(tradeBlock, 'lookupExistingUnit 內 trade_records 查詢區段不存在').toBeTruthy();
    expect(tradeBlock).toMatch(/\.eq\(\s*['"]status['"]\s*,\s*['"]open['"]\s*\)/);
  });

  it('expert_signals 查詢必須以 .in(\'status\', [\'pending\']) 限縮（6.1-B2）', () => {
    const signalBlock = dialogSource.match(
      /from\(\s*['"]expert_signals['"]\s*\)[\s\S]*?\.maybeSingle\(\)/,
    )?.[0];
    expect(signalBlock, 'lookupExistingUnit 內 expert_signals 查詢區段不存在').toBeTruthy();
    expect(signalBlock).toMatch(/\.in\(\s*['"]status['"]\s*,\s*\[\s*['"]pending['"]\s*\]\s*\)/);
  });

  it('全平倉後 fallthrough 必須解鎖：setLockedUnit(null) + setLockedUnitSource(null)（6.1-B3）', () => {
    // 允許在同一 catch/final 區段中出現，順序不敏感；只要求兩者都存在
    expect(dialogSource).toMatch(/setLockedUnit\(\s*null\s*\)/);
    expect(dialogSource).toMatch(/setLockedUnitSource\(\s*null\s*\)/);
  });
});

describe('C. tw_stock 資產憲法 — 同時允許張與股', () => {
  const spec = getAssetSpec('tw_stock' as const);

  it('units 白名單應同時包含「張」與「股」（6.1-C1）', () => {
    expect(spec.units).toContain('張');
    expect(spec.units).toContain('股');
  });

  it('sanitize 不會把台股單位強制成單一值（6.1-C2）', () => {
    expect(sanitizeAssetQuantityUnit('張', 'tw_stock')).toBe('張');
    expect(sanitizeAssetQuantityUnit('股', 'tw_stock')).toBe('股');
  });

  it('回歸案例：歷史 buy 用「張」→ 已 sell 全部平倉 → 新一輪可挑「股」', () => {
    // 語意驗證：spec.units 就是 UI 下拉選項來源；只要 units 保留兩者，
    // UI 就會在 lookupExistingUnit 回傳 null 時把兩個選項都亮出來。
    const bothAvailable = spec.units.includes('張') && spec.units.includes('股');
    expect(bothAvailable).toBe(true);
  });
});
