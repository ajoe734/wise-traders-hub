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
    // 二選一：抽屜把持股股數與現價傳入確認視窗，onConfirm 轉送 choice
    expect(panel).toContain('heldQty={Number(h.qty) || null}');
    expect(panel).toContain('currentPrice={Number(h.price) || null}');
    expect(panel).toContain('onDeleteHolding(h.code, choice)');
  });

  it('刪除視窗提供「記賣出並刪除」與「只刪除持倉」二選一', () => {
    const dialog = read('src/checkup/components/freecheckup/HoldingDeleteDialog.tsx');
    expect(dialog).toContain('data-testid="holding-delete-sell"');
    expect(dialog).toContain('data-testid="holding-delete-remove-only"');
    expect(dialog).toContain('holding-delete-sell-qty');
    expect(dialog).toContain('holding-delete-sell-price');
  });

  it('FreeCheckup 記賣出路徑走 buildSellTradeEntry + 既有 commit 管線', () => {
    const source = read('src/pages/FreeCheckup.jsx');
    expect(source).toContain('buildSellTradeEntry');
    expect(source).toContain('choice.withSell');
    expect(source).toContain('mergeTradeIntoHoldings(');
    expect(source).toContain('setTradeLog((prev) => [entry, ...(prev || [])])');
  });
});