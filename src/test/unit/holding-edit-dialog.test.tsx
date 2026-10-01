import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HoldingEditDialog from '@/checkup/components/freecheckup/HoldingEditDialog';

const holding = { code: '6213', name: '聯茂', qty: 1000, cost: 80, price: 100 };

describe('編輯持倉對話框', () => {
  it('顯示股數和成本；取消不新增交易', () => {
    const onConfirm = vi.fn();
    render(<HoldingEditDialog open onOpenChange={vi.fn()} holding={holding} onConfirm={onConfirm} />);
    expect(screen.getByTestId('holding-edit-qty')).toHaveValue(1000);
    expect(screen.getByTestId('holding-edit-cost')).toHaveValue(80);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('成交價格填寫後，真實加碼股數自動推算成本並提交交易', async () => {
    const onConfirm = vi.fn().mockResolvedValue({ ok: true });
    render(<HoldingEditDialog open onOpenChange={vi.fn()} holding={holding} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByTestId('holding-edit-qty'), { target: { value: '2000' } });
    fireEvent.change(screen.getByTestId('holding-edit-price'), { target: { value: '180' } });
    expect(screen.getByTestId('holding-edit-cost')).toHaveValue(130);
    fireEvent.click(screen.getByTestId('holding-edit-submit'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ ok: true, entry: expect.objectContaining({ action: '買進', qty: 1000, price: 180 }) })));
  });

  it('只改成本無成交時明確阻擋，不能造出買賣紀錄', () => {
    const onConfirm = vi.fn();
    render(<HoldingEditDialog open onOpenChange={vi.fn()} holding={holding} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByTestId('holding-edit-cost'), { target: { value: '90' } });
    fireEvent.click(screen.getByTestId('holding-edit-submit'));
    expect(screen.getByRole('alert')).toHaveTextContent('交易紀錄');
    expect(onConfirm).not.toHaveBeenCalled();
  });
});