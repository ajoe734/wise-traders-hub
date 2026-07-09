/**
 * 迴歸鎖：HoldingsWorkbench 傳給 HoldingCard 的 meta，
 * 必須與族群聚合面板同源（getMultiMeta，走 5 層權威），
 * 否則會出現「卡片顯示未分類、聚合卡卻有 TWSE 產業」的不一致。
 *
 * 這裡不掛整個 React tree，直接掃 source，確保：
 *   - HoldingsWorkbench.tsx 匯入 getMultiMeta，不再匯入 mergeMeta
 *   - HoldingCard 傳入的 meta 表達式呼叫 getMultiMeta(...)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), 'src/checkup/components/freecheckup/HoldingsWorkbench.tsx'),
  'utf8',
);

describe('HoldingsWorkbench meta source', () => {
  it('匯入 getMultiMeta，禁止匯入 mergeMeta', () => {
    expect(source).toMatch(/from ['"]@\/checkup\/lib\/stockMetaMulti(\.js)?['"]/);
    expect(source).toMatch(/getMultiMeta/);
    expect(source).not.toMatch(/import\s*\{\s*mergeMeta\s*\}/);
  });

  it('HoldingCard 的 meta prop 用 getMultiMeta 產生', () => {
    expect(source).toMatch(/meta=\{getMultiMeta\(/);
    expect(source).not.toMatch(/meta=\{mergeMeta\(/);
  });
});
