/**
 * T3 — ManualTradeForm 元件行為（PLAN_V4.1）
 *
 * 驗收重點：
 *  - code → name 非同步解析的 race：舊回應永不覆蓋新 code
 *  - 錯誤只在按下「加入這筆成交」後才顯示（不用 disabled 隱藏原因）
 *  - TW 整數 / US 可小數的 input step 與 inputMode
 *  - demo 模式送出：0 mutation（onAdd 完全沒被呼叫）
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/stockNameResolver', () => ({
  resolveStockName: vi.fn(async (code: string) => (code === '2330' ? '台積電' : null)),
  resolveStockNames: vi.fn(async () => ({})),
}));
vi.mock('@/lib/paywallTracking', () => ({ trackPaywall: vi.fn() }));
vi.mock('@/pages/_freeCheckup/constants', () => ({
  markUserOwnedHolding: (h: unknown) => h,
  MAX_HOLDINGS: 50,
  WB: {},
}));
vi.mock('@/pages/_freeCheckup/constants.jsx', () => ({
  markUserOwnedHolding: (h: unknown) => h,
  MAX_HOLDINGS: 50,
  WB: {},
}));

import { ManualTradeForm } from '@/checkup/modules/tradeIO/free';
import { MANUAL_ROW_KEYS } from '@/checkup/lib/manualTradeEntry';

const C: Record<string, string> = {
  bg: '#F5F3EF', card: '#fff', subtle: '#EEE', border: '#DDD',
  text: '#292520', textSec: '#4A4A4A', textMute: '#8A8A8A',
  amber: '#EC662D', blue: '#3B6EA5', teal: '#2D7D7D', up: '#C0392B', down: '#1E824C',
};
const alpha = (c: string) => c;
const card = {};
const lbl = {};

function renderForm(onAdd = vi.fn()) {
  render(
    <ManualTradeForm
      C={C}
      alpha={alpha}
      card={card}
      lbl={lbl}
      isDemo={false}
      onAdd={onAdd}
      holdingsCount={0}
      maxHoldings={50}
    />,
  );
  return onAdd;
}

async function fillValidDraft() {
  fireEvent.change(screen.getByLabelText('股票代碼'), { target: { value: '2330' } });
  await waitFor(() => expect((screen.getByLabelText('股票名稱') as HTMLInputElement).value).toBe('台積電'));
  fireEvent.change(screen.getByLabelText('股數'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('成交價'), { target: { value: '1100' } });
}

describe('ManualTradeForm — 只輸出 row，不提交', () => {
  beforeEach(() => vi.clearAllMocks());

  it('填完必填欄位後 onAdd 收到 exact 12-key row', async () => {
    const onAdd = renderForm();
    await fillValidDraft();
    fireEvent.click(screen.getByLabelText('加入這筆成交'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const row = onAdd.mock.calls[0][0];
    expect(Object.keys(row).sort()).toEqual([...MANUAL_ROW_KEYS].sort());
    expect(row.priceSource).toBe('manual');
    expect(row.code).toBe('2330');
    expect(row.name).toBe('台積電');
    expect(row.qty).toBe(1000);
  });

  it('draft 專屬 nameDirty 不會流進 row', async () => {
    const onAdd = renderForm();
    await fillValidDraft();
    fireEvent.change(screen.getByLabelText('股票名稱'), { target: { value: '台積電A' } });
    fireEvent.click(screen.getByLabelText('加入這筆成交'));
    expect(onAdd.mock.calls[0][0]).not.toHaveProperty('nameDirty');
    expect(onAdd.mock.calls[0][0].name).toBe('台積電A');
  });

  it('code 改變會清掉未手改的名稱，避免 code=AMD/name=台積電', async () => {
    renderForm();
    await fillValidDraft();
    fireEvent.change(screen.getByLabelText('股票代碼'), { target: { value: 'AMD' } });
    await waitFor(() =>
      expect((screen.getByLabelText('股票名稱') as HTMLInputElement).value).not.toBe('台積電'),
    );
  });

  it('美股允許小數股數、台股不允許', async () => {
    const onAdd = renderForm();
    fireEvent.change(screen.getByLabelText('股票代碼'), { target: { value: 'amd' } });
    fireEvent.change(screen.getByLabelText('股數'), { target: { value: '0.5' } });
    fireEvent.change(screen.getByLabelText('成交價'), { target: { value: '210' } });
    fireEvent.change(screen.getByLabelText('股票名稱'), { target: { value: 'AMD' } });
    fireEvent.click(screen.getByLabelText('加入這筆成交'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].qty).toBe(0.5);

    fireEvent.change(screen.getByLabelText('股票代碼'), { target: { value: '2330' } });
    fireEvent.change(screen.getByLabelText('股數'), { target: { value: '0.5' } });
    fireEvent.change(screen.getByLabelText('成交價'), { target: { value: '1100' } });
    fireEvent.click(screen.getByLabelText('加入這筆成交'));
    expect(onAdd).toHaveBeenCalledTimes(1); // 仍是 1，台股小數被擋
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
  });

  it('demo 模式無法加入', async () => {
    const onAdd = vi.fn();
    render(
      <ManualTradeForm C={C} alpha={alpha} card={card} lbl={lbl} isDemo onAdd={onAdd} holdingsCount={0} maxHoldings={50} />,
    );
    fireEvent.click(screen.getByLabelText('加入這筆成交'));
    expect(onAdd).not.toHaveBeenCalled();
  });
});


describe('T3 — code/name race、錯誤時機、input step、demo 0 mutation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('慢回應的舊 code 解析結果不得覆蓋新 code 的名稱', async () => {
    const { resolveStockName } = await import('@/lib/stockNameResolver');
    const slow = resolveStockName as unknown as ReturnType<typeof vi.fn>;
    let releaseFirst: (v: string) => void = () => {};
    slow.mockImplementationOnce(
      () => new Promise<string>((res) => { releaseFirst = res; }),
    );
    slow.mockImplementationOnce(async () => 'AMD Inc');

    renderForm();
    fireEvent.change(screen.getByLabelText('股票代碼'), { target: { value: '2330' } });
    fireEvent.change(screen.getByLabelText('股票代碼'), { target: { value: 'AMD' } });
    await waitFor(() =>
      expect((screen.getByLabelText('股票名稱') as HTMLInputElement).value).toBe('AMD Inc'),
    );
    // 舊 promise 現在才回來 —— 必須被 sequence token 丟棄
    releaseFirst('台積電');
    await Promise.resolve();
    await waitFor(() =>
      expect((screen.getByLabelText('股票名稱') as HTMLInputElement).value).toBe('AMD Inc'),
    );
    expect((screen.getByLabelText('股票代碼') as HTMLInputElement).value).toBe('AMD');
  });

  it('未按送出前不顯示任何錯誤；按下才顯示', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('股數'), { target: { value: '' } });
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    fireEvent.click(screen.getByLabelText('加入這筆成交'));
    expect(screen.queryAllByRole('alert').length).toBeGreaterThan(0);
  });

  it('TW step=1 整數、US step=any 可小數', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('股票代碼'), { target: { value: '2330' } });
    const twQty = screen.getByLabelText('股數') as HTMLInputElement;
    expect(twQty.getAttribute('step')).toBe('1');
    expect(twQty.getAttribute('inputmode')).toBe('numeric');

    fireEvent.change(screen.getByLabelText('股票代碼'), { target: { value: 'AMD' } });
    const usQty = screen.getByLabelText('股數') as HTMLInputElement;
    expect(usQty.getAttribute('step')).toBe('any');
    expect(usQty.getAttribute('inputmode')).toBe('decimal');
  });

  it('demo 模式即使填完整也 0 mutation', async () => {
    const onAdd = vi.fn();
    render(
      <ManualTradeForm C={C} alpha={alpha} card={card} lbl={lbl} isDemo onAdd={onAdd} holdingsCount={0} maxHoldings={50} />,
    );
    await fillValidDraft();
    fireEvent.click(screen.getByLabelText('加入這筆成交'));
    fireEvent.click(screen.getByLabelText('加入這筆成交'));
    expect(onAdd).not.toHaveBeenCalled();
  });
});
