/**
 * HoldingDeleteDialog 二選一互動：
 *  - 記賣出並刪除：預填全部持股＠現價，可編輯，onConfirm 收到 { withSell:true, qty, price }
 *  - oversell：顯示錯誤且不呼叫 onConfirm
 *  - 只刪除持倉：onConfirm 收到 { withSell:false }
 *  - 取消：只關視窗，不呼叫 onConfirm
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import HoldingDeleteDialog from '@/checkup/components/freecheckup/HoldingDeleteDialog';

describe('HoldingDeleteDialog 二選一', () => {
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn(async () => ({ ok: true }));

  const renderDialog = (props = {}) => render(
    <HoldingDeleteDialog
      open
      onOpenChange={onOpenChange}
      code="2338"
      name="光罩"
      heldQty={1000}
      currentPrice={61.8}
      onConfirm={onConfirm}
      {...props}
    />,
  );

  beforeEach(() => {
    onOpenChange.mockClear();
    onConfirm.mockClear();
  });

  it('預填全部持股＠現價，並顯示預估賣出金額', () => {
    renderDialog();
    expect((screen.getByTestId('holding-delete-sell-qty') as HTMLInputElement).value).toBe('1000');
    expect((screen.getByTestId('holding-delete-sell-price') as HTMLInputElement).value).toBe('61.8');
    expect(screen.getByTestId('holding-delete-sell-estimate').textContent).toContain('61,800');
  });

  it('記賣出並刪除：送出可編輯後的股數與價格', async () => {
    renderDialog();
    fireEvent.change(screen.getByTestId('holding-delete-sell-qty'), { target: { value: '300' } });
    fireEvent.change(screen.getByTestId('holding-delete-sell-price'), { target: { value: '62' } });
    fireEvent.click(screen.getByTestId('holding-delete-sell'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith({ withSell: true, qty: 300, price: 62 });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('oversell：顯示錯誤且不送出', () => {
    renderDialog();
    fireEvent.change(screen.getByTestId('holding-delete-sell-qty'), { target: { value: '2000' } });
    fireEvent.click(screen.getByTestId('holding-delete-sell'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('holding-delete-error').textContent).toContain('超過目前持有 1000 股');
  });

  it('非正數價格：顯示錯誤且不送出', () => {
    renderDialog();
    fireEvent.change(screen.getByTestId('holding-delete-sell-price'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('holding-delete-sell'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('holding-delete-error').textContent).toContain('賣出價格需大於 0');
  });

  it('只刪除持倉：onConfirm 收到 withSell:false', async () => {
    renderDialog();
    fireEvent.click(screen.getByTestId('holding-delete-remove-only'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith({ withSell: false });
  });

  it('取消：只關視窗，不呼叫 onConfirm', () => {
    renderDialog();
    fireEvent.click(screen.getByTestId('holding-delete-cancel'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
