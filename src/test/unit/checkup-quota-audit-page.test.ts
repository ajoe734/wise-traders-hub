/**
 * CheckupQuotaAudit 前端結構合約測試。
 * 守住分頁 UI 與 fallback helper 的使用，避免回歸：
 *   - 必須使用 formatTaipeiYMDHMWithFallback 渲染 used_at / last_used_at
 *   - 必須有「上一頁 / 下一頁」按鈕 + page state
 *   - 必須在 query string 帶 page / page_size
 *   - CSV 必須明示是「目前頁」
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = readFileSync(
  resolve(__dirname, '../../pages/company/CheckupQuotaAudit.tsx'),
  'utf-8',
);

describe('CheckupQuotaAudit page — pagination + fallback', () => {
  it('使用 formatTaipeiYMDHMWithFallback 於批次表格與 CSV', () => {
    expect(SRC).toMatch(/formatTaipeiYMDHMWithFallback/);
    // 至少呼叫 3 次（used_at table、last_used_at table、CSV）
    const count = SRC.match(/formatTaipeiYMDHMWithFallback/g)?.length || 0;
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('runList 必須帶 page / page_size 參數', () => {
    expect(SRC).toMatch(/page:\s*String\(targetPage\)/);
    expect(SRC).toMatch(/page_size:\s*String\(pageSize\)/);
  });

  it('有「上一頁 / 下一頁」按鈕', () => {
    expect(SRC).toMatch(/上一頁/);
    expect(SRC).toMatch(/下一頁/);
  });

  it('CSV 匯出明示是「目前頁」', () => {
    expect(SRC).toMatch(/下載目前頁 CSV/);
  });

  it('pageSize 預設 50、選項受控（不允許自由輸入導致濫用）', () => {
    expect(SRC).toMatch(/useState\(50\)/);
    // 選單包含常見值
    expect(SRC).toMatch(/\[25,\s*50,\s*100,\s*200,\s*500\]/);
  });

  it('applyFilters 套用篩選時重設 page=1', () => {
    expect(SRC).toMatch(/setPage\(1\)/);
  });
});
