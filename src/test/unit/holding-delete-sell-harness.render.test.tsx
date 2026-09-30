/**
 * HoldingDeleteSellHarnessEntry 互動流程（jsdom）：
 *  - 記賣出（全數 / 部分）→ 持倉扣減 / 移除，tradeLog 前插，零排除標記
 *  - 只刪除 → 寫排除標記，tradeLog 不動
 *  - oversell → 顯示錯誤且不送出
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import HoldingDeleteSellHarnessEntry from '@/pages/HoldingDeleteSellHarnessEntry';

const text = (id: string) => screen.getByTestId(id).textContent;

describe('HoldingDeleteSellHarnessEntry', () => {
  it('記賣出（全數→移除；部分→扣股數）+ 只刪除（排除標記）', async () => {
    render(<HoldingDeleteSellHarnessEntry />);
    await waitFor(() => expect(text('holdings-count')).toBe('holdings_count=3'));

    // 1) 2338 全數賣出 → 移出持倉，tradeLog 前插，零排除標記
    fireEvent.click(screen.getByTestId('delete-2338'));
    expect((screen.getByTestId('holding-delete-sell-qty') as HTMLInputElement).value).toBe('1000');
    expect(screen.getByTestId('holding-delete-sell-estimate').textContent).toContain('61,800');
    fireEvent.click(screen.getByTestId('holding-delete-sell'));
    await waitFor(() => expect(text('holdings-count')).toBe('holdings_count=2'));
    expect(screen.queryByTestId('holding-row-2338')).toBeNull();
    expect(text('trade-log-count')).toBe('trade_log_count=1');
    expect(text('trade-log-0')).toContain('賣出 2338 光罩 qty=1000 price=61.8');
    expect(text('exclusion-count')).toBe('exclusion_count=0');

    // 2) 6706 部分賣出 200 股 → 留 300 股
    fireEvent.click(screen.getByTestId('delete-6706'));
    fireEvent.change(screen.getByTestId('holding-delete-sell-qty'), { target: { value: '200' } });
    fireEvent.click(screen.getByTestId('holding-delete-sell'));
    await waitFor(() => expect(text('trade-log-count')).toBe('trade_log_count=2'));
    expect(screen.getByTestId('holding-qty-6706').textContent).toBe('qty=300');

    // 3) 0050 只刪除 → 移出持倉＋排除標記，tradeLog 不動
    fireEvent.click(screen.getByTestId('delete-0050'));
    fireEvent.click(screen.getByTestId('holding-delete-remove-only'));
    await waitFor(() => expect(text('exclusion-count')).toBe('exclusion_count=1'));
    expect(text('holdings-count')).toBe('holdings_count=1');
    expect(text('trade-log-count')).toBe('trade_log_count=2');
  });

  it('oversell：錯誤留在視窗內，資料不動', async () => {
    render(<HoldingDeleteSellHarnessEntry />);
    await waitFor(() => expect(text('holdings-count')).toBe('holdings_count=3'));
    fireEvent.click(screen.getByTestId('delete-2338'));
    fireEvent.change(screen.getByTestId('holding-delete-sell-qty'), { target: { value: '2000' } });
    fireEvent.click(screen.getByTestId('holding-delete-sell'));
    expect(screen.getByTestId('holding-delete-error').textContent).toContain('超過目前持有 1000 股');
    // 修正為合法值後可送出
    fireEvent.change(screen.getByTestId('holding-delete-sell-qty'), { target: { value: '1000' } });
    fireEvent.click(screen.getByTestId('holding-delete-sell'));
    await waitFor(() => expect(screen.getByTestId('holdings-count').textContent).toBe('holdings_count=2'));
    expect(screen.queryByTestId('holding-delete-error')).toBeNull();
  });

  it('取消：視窗關閉，資料不動', async () => {
    render(<HoldingDeleteSellHarnessEntry />);
    await waitFor(() => expect(text('holdings-count')).toBe('holdings_count=3'));
    fireEvent.click(screen.getByTestId('delete-2338'));
    fireEvent.click(screen.getByTestId('holding-delete-cancel'));
    await waitFor(() => expect(screen.queryByTestId('holding-delete-confirm-dialog')).toBeNull());
    expect(text('holdings-count')).toBe('holdings_count=3');
    expect(text('trade-log-count')).toBe('trade_log_count=0');
    expect(text('exclusion-count')).toBe('exclusion_count=0');
  });
});
