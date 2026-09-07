/**
 * 回歸：新增成交 modal 的 focus trap 不得在父層重繪時重跑。
 *
 * 修前紅：TradeUploadModal 的 effect 相依 `[open, onClose]`，父層每次 render
 * 新建 onClose → cleanup + 重跑 → 焦點被搶回 dialog 容器，使用者手動輸入
 * 股票代碼會被中斷（持倉冷卻倒數每秒 tick 就每秒斷一次）。
 */
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('@/checkup/components/freecheckup/TradeTab', () => ({
  default: () => <input aria-label="股票代碼" />,
}));

import TradeUploadModal from '@/checkup/components/freecheckup/TradeUploadModal';

const C = { bg: '#F5F3EF', text: '#292520', border: '#DDD', textMute: '#8A8A8A', textSec: '#4A4A4A' };

function Host() {
  const [, setTick] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setTick((n) => n + 1)}>tick</button>
      <TradeUploadModal
        open
        // 故意每次 render 新建（模擬原本 FreeCheckup 的 inline arrow）
        onClose={() => {}}
        C={C}
        alpha={(c: string) => c}
        quota={undefined}
        formatResetCountdown={() => ''}
        tradeProps={{}}
      />
    </>
  );
}

describe('TradeUploadModal — focus 穩定性', () => {
  it('父層重繪時不會把焦點從輸入框搶走', async () => {
    render(<Host />);
    // 等開啟時的 setTimeout focus 走完
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    const input = screen.getByLabelText('股票代碼') as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    const tickBtn = screen.getByRole('button', { name: 'tick' });
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        tickBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 20));
      });
      // 重繪不得搶焦點（tick 按鈕是用 dispatchEvent，不會轉移焦點）
      expect(document.activeElement).toBe(input);
    }
  });
});
