/**
 * 成交上傳 / 解析 gate 回歸測試
 *
 * 業務憲法（不准再被偷偷改回去）：
 *   - 上傳成交 = auth gate（只看 isDemo / 未登入）
 *   - 解析成交 = auth gate（後端 checkup-parse 為 auth-only，不消耗 quota）
 *   - 收盤分析 = quota gate（subscription + monthly/weekly/lifetime quota）
 *
 * 此檔案掃描原始碼確認：
 *   1. useTradeCaptureRuntime 不再以 hasQuota === false 擋上傳/解析
 *   2. TradeTab 不再以 hasReachedDailyLimit 隱藏上傳區（仍可顯示「分析額度」資訊提示）
 *   3. checkup-parse edge 仍然是 requireCheckupAuth（不是 consumeCheckupQuota）
 *   4. checkup-analyze edge 仍然是 consumeCheckupQuota
 *
 * 任何一條失守 → 視為舊會員/補償會員上傳成交被誤擋的迴歸。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

describe('成交上傳/解析 gate 與收盤分析配額嚴格分離', () => {
  it('useTradeCaptureRuntime: enqueueFiles / parseUploadById 都不再用 hasQuota === false 阻擋', () => {
    const src = read('src/checkup/hooks/useTradeCaptureRuntime.js');
    expect(src).not.toMatch(/hasQuota\s*===\s*false/);
    // 也不要再從 mode context 解構出 hasQuota（避免暗用）
    expect(src).not.toMatch(/\{\s*hasQuota[\s,}]/);
  });

  it('useTradeCaptureRuntime: isDemo 仍然是擋上傳/解析的唯一前端 gate', () => {
    const src = read('src/checkup/hooks/useTradeCaptureRuntime.js');
    expect(src).toMatch(/if\s*\(\s*isDemo\s*\)\s*\{[\s\S]*?訪客模式不能上傳成交/);
    expect(src).toMatch(/if\s*\(\s*isDemo\s*\)\s*\{[\s\S]*?訪客模式不能解析成交/);
  });

  it('TradeTab: 已登入 + hasReachedDailyLimit 仍要可看到上傳區（不能整區隱藏）', () => {
    const src = read('src/checkup/components/freecheckup/TradeTab.jsx');
    // 上傳區的渲染條件不可再帶 !hasReachedDailyLimit
    expect(src).not.toMatch(/!parsed\s*&&\s*!isDemo\s*&&\s*!hasReachedDailyLimit/);
    // 仍允許顯示「收盤分析配額用盡」資訊提示，但需明示「不影響成交上傳」
    expect(src).toMatch(/不影響成交上傳/);
  });

  it('checkup-parse edge：必須是 requireCheckupAuth，不可改成 consumeCheckupQuota', () => {
    const src = read('supabase/functions/checkup-parse/index.ts');
    expect(src).toMatch(/requireCheckupAuth\s*\(/);
    expect(src).not.toMatch(/consumeCheckupQuota\s*\(/);
  });

  it('checkup-analyze edge：必須維持 consumeCheckupQuota(daily-analysis)', () => {
    const src = read('supabase/functions/checkup-analyze/index.ts');
    expect(src).toMatch(/consumeCheckupQuota\([^,]+,\s*['"]daily-analysis['"]/);
  });

  it('checkup-analyze edge：收盤分析主流程需優先走低延遲模型，避免 iPhone Safari Load failed', () => {
    const src = read('supabase/functions/checkup-analyze/index.ts');
    expect(src).toMatch(/const\s+preferFast\s*=\s*body\?\.kind\s*!==\s*['"]brain-update['"]/);
    expect(src).toMatch(/callAI\(messages,\s*0\.3,\s*8192,\s*preferFast\)/);
    expect(src).toMatch(/if\s*\(preferFast\)\s*\{[\s\S]*callGateway\(\)[\s\S]*callDirectGemini\(\)[\s\S]*callAnthropic\(\)/);
  });

  it('CheckupModeContext：canUpload 仍是 mode !== "demo"（不可改成綁配額）', () => {
    const src = read('src/checkup/contexts/CheckupModeContext.jsx');
    expect(src).toMatch(/canUpload\s*=\s*mode\s*!==\s*['"]demo['"]/);
    // 不可在 canUpload 處引入 hasQuota / hasReachedDailyLimit
    expect(src).not.toMatch(/canUpload\s*=\s*mode[\s\S]{0,40}hasQuota/);
    expect(src).not.toMatch(/canUpload\s*=\s*mode[\s\S]{0,40}hasReachedDailyLimit/);
  });

  it('FreeCheckup.parseShot：截圖解析路徑禁止 quota 前置攔截', () => {
    const src = read('src/pages/FreeCheckup.jsx');
    const m = src.match(/const\s+parseShot\s*=\s*async[\s\S]*?\n  \};/);
    expect(m, 'parseShot 函式必須能被定位').toBeTruthy();
    const body = m![0];
    // parseShot 內不可再用 hasReachedDailyLimit / remaining<=0 擋掉解析
    expect(body).not.toMatch(/hasReachedDailyLimit/);
    expect(body).not.toMatch(/remaining\s*<=\s*0/);
    // 「AI 健檢配額已用完」屬於收盤分析文案，不可出現在截圖解析路徑
    expect(body).not.toMatch(/AI 健檢配額已用完/);
  });
});
