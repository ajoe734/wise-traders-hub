import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');

describe('持倉刪除正式頁面接線', () => {
  it('FreeCheckup 建立刪除服務並傳給 HoldingsTab', () => {
    const source = read('src/pages/FreeCheckup.jsx');
    expect(source).toContain('useHoldingExclusions({');
    expect(source).toContain('onDeleteHolding={handleDeleteHolding}');
    expect(source).toContain('onClearHoldingExclusion: clearHoldingExclusion');
  });

  it('HoldingsTab 經 HoldingsWorkbench 傳入詳細抽屜', () => {
    const tab = read('src/checkup/components/freecheckup/HoldingsTab.tsx');
    const workbench = read('src/checkup/components/freecheckup/HoldingsWorkbench.tsx');
    expect(tab).toContain('onDeleteHolding={onDeleteHolding}');
    expect(workbench).toContain('onDeleteHolding={onDeleteHolding}');
  });

  it('詳細抽屜保留刪除入口與確認視窗', () => {
    const panel = read('src/checkup/components/freecheckup/HoldingsDetailPanel.tsx');
    expect(panel).toContain('data-testid="holding-delete-trigger"');
    expect(panel).toContain('<HoldingDeleteDialog');
  });
});