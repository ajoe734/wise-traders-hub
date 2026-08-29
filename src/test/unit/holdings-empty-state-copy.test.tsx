/**
 * 文案回歸：空倉引導與新增成交 modal 必須涵蓋「截圖上傳」與「手動輸入」兩條等價路徑。
 *
 * 背景：手動輸入功能上線後，空倉區塊仍寫「無需手動輸入」、「上傳截圖」為唯一入口，
 * 與功能互相矛盾。此測試鎖定新文案契約，禁止回退。
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import HoldingsEmptyState from '@/checkup/components/freecheckup/HoldingsEmptyState';

const WB = {
  hair: '#ddd', hairStrong: '#bbb', ink: '#292520', inkMute: '#8a857c',
};

describe('HoldingsEmptyState — 雙路徑文案契約', () => {
  it('空倉區塊同時涵蓋截圖與手動輸入，主 CTA 為「新增成交」', () => {
    const { container } = render(<HoldingsEmptyState WB={WB} onUpload={() => {}} />);
    const text = container.textContent || '';

    // 三步驟：不偏袒單一路徑
    expect(text).toContain('新增成交');
    expect(text).toContain('辨識或填寫');
    expect(text).toContain('確認更新');

    // 兩條等價路徑都被提及
    expect(text).toContain('截圖');
    expect(text).toContain('手動輸入');
    expect(text).toContain('或切換手動輸入');

    // 主 CTA 文案
    const cta = container.querySelector('button.holdings-empty-cta');
    expect(cta?.textContent?.trim()).toBe('新增成交');

    // 禁語：不得再把截圖描述成唯一入口
    expect(text).not.toContain('無需手動輸入');
    expect(text).not.toContain('現在上傳成交');
    expect(text).not.toContain('AI 辨識');
  });
});
