import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * ADR-0005 §5 — 批次解析面板槽位注入
 *
 * HoldingsTab（M1 Holdings）不得直連 BatchParsePanel（M4 TradeIO）。
 * 面板由 shell（FreeCheckup.jsx）以 `batchParseSlot` prop 注入。
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const HOLDINGS_TAB = 'src/checkup/components/freecheckup/HoldingsTab.tsx';
const SHELL = 'src/pages/FreeCheckup.jsx';

describe('ADR-0005 §5 batchParseSlot', () => {
  it('HoldingsTab 不 import M4 的 BatchParsePanel', () => {
    const src = read(HOLDINGS_TAB);
    expect(src).not.toMatch(/import\s+[^;]*BatchParsePanel/);
    expect(src).not.toMatch(/<BatchParsePanel/);
  });

  it('HoldingsTab 接受並渲染 batchParseSlot', () => {
    const src = read(HOLDINGS_TAB);
    expect(src).toMatch(/batchParseSlot:\s*_opt/);
    expect(src).toContain('{batchParseSlot}');
  });

  it('HoldingsTab 不再接收批次狀態的四個 prop（改由 shell 組成槽位）', () => {
    const src = read(HOLDINGS_TAB);
    for (const prop of ['batchState', 'cancelBatch', 'retryBatchFailures', 'restoreBatchItemPreview']) {
      expect(src).not.toContain(prop);
    }
  });

  it('shell 以 tradeIO/free barrel lazy 載入 BatchParsePanel 並注入槽位', () => {
    const src = read(SHELL);
    expect(src).toMatch(/lazy\(\(\)\s*=>\s*import\("@\/checkup\/modules\/tradeIO\/free"\)[\s\S]{0,80}BatchParsePanel/);
    expect(src).toContain('batchParseSlot={batchParseSlot}');
    // 沒有批次項目時不渲染 → tradeIO chunk 不會因為 holdings tab 被載入
    expect(src).toMatch(/const batchParseSlot = batchState\?\.items\?\.length \?/);
  });

  it('shell 不深挖 freecheckup 的 BatchParsePanel 實作檔', () => {
    const src = read(SHELL);
    expect(src).not.toContain('freecheckup/BatchParsePanel');
  });
});
