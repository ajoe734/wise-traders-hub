/**
 * HOLDINGS_31_BATCH_AND_NAME_RACE_FIX — B：手動名稱不得被晚到的 resolver 覆蓋
 *
 * 真實現場（QA b3502f0a…，2026/08/29 20:21 Taipei）：
 *   code 2207 輸入後 resolver 未即時回填，使用者手動填「和泰車」，
 *   最後落地的 log/memo 卻是 `name = "2207"`（= code fallback）。
 *
 * 契約（本輪憲法）：
 *   resolver 只有在「code 未變」且「name 自 request 啟動後未被使用者編輯（含 IME 組字）」
 *   且「目前 name 為空」時，才可自動寫入；
 *   **code fallback 絕不可寫入 name 欄位**（要 fallback 由 buildManualTradeRow 在送出時做）。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('@/lib/stockNameResolver', () => ({
  resolveStockName: vi.fn(async () => null),
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

const C: Record<string, string> = {
  bg: '#F5F3EF', card: '#fff', subtle: '#EEE', border: '#DDD',
  text: '#292520', textSec: '#4A4A4A', textMute: '#8A8A8A',
  amber: '#EC662D', blue: '#3B6EA5', teal: '#2D7D7D', up: '#C0392B', down: '#1E824C',
};
const alpha = (c: string) => c;

function renderForm(onAdd = vi.fn()) {
  render(
    <ManualTradeForm
      C={C} alpha={alpha} card={{}} lbl={{}} isDemo={false}
      onAdd={onAdd} holdingsCount={0} maxHoldings={50}
    />,
  );
  return onAdd;
}

const flush = async () => {
  await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
};

const codeInput = () => screen.getByLabelText('股票代碼') as HTMLInputElement;
const nameInput = () => screen.getByLabelText('股票名稱') as HTMLInputElement;

/** 讓 resolver 掛住，之後由測試決定何時回應 —— 精準重現「320ms 還沒回來」。 */
async function pendingResolver() {
  const { resolveStockName } = await import('@/lib/stockNameResolver');
  const fn = resolveStockName as unknown as ReturnType<typeof vi.fn>;
  let release: (v: string | null) => void = () => {};
  fn.mockImplementationOnce(() => new Promise((res) => { release = res; }));
  return {
    release: async (v: string | null) => {
      await act(async () => {
        release(v);
        for (let i = 0; i < 8; i += 1) await Promise.resolve();
      });
    },
  };
}

describe('B — 手動名稱 vs 晚到 resolver', () => {
  beforeEach(() => vi.clearAllMocks());

  it('2207：resolver pending → 手填「和泰車」→ resolver 晚到回 null（code fallback）→ 名稱仍是和泰車', async () => {
    const { release } = await pendingResolver();
    const onAdd = renderForm();

    fireEvent.change(codeInput(), { target: { value: '2207' } });
    await flush(); // resolver 已發出、尚未回應（現場的「約 320ms」）
    fireEvent.change(nameInput(), { target: { value: '和泰車' } });
    await release(null);

    expect(nameInput().value).toBe('和泰車');

    fireEvent.change(screen.getByLabelText('股數'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('成交價'), { target: { value: '100' } });
    fireEvent.click(screen.getByLabelText('加入這筆成交'));
    expect(onAdd.mock.calls[0][0].name).toBe('和泰車');
  });

  it('resolver 晚到回傳「與 code 相同」的字串也不得覆蓋手填名稱', async () => {
    const { release } = await pendingResolver();
    renderForm();
    fireEvent.change(codeInput(), { target: { value: '2207' } });
    await flush(); // resolver 已發出、尚未回應（現場的「約 320ms」）
    fireEvent.change(nameInput(), { target: { value: '和泰車' } });
    await release('2207');
    expect(nameInput().value).toBe('和泰車');
  });

  it('IME 組字中（compositionstart 尚未 commit）resolver 不得清掉/覆寫名稱欄位', async () => {
    const { release } = await pendingResolver();
    const onAdd = renderForm();

    fireEvent.change(codeInput(), { target: { value: '2207' } });
    await flush(); // resolver 已發出、尚未回應（現場的「約 320ms」）
    // 使用者開始用注音輸入名稱：Safari/部分 IME 在 commit 前不會觸發 change
    fireEvent.compositionStart(nameInput());
    await release(null);
    // 舊行為：這裡會被寫成 '2207'，使用者的組字被 re-render 清掉
    expect(nameInput().value).toBe('');

    fireEvent.compositionEnd(nameInput(), { data: '和泰車' });
    fireEvent.change(nameInput(), { target: { value: '和泰車' } });
    fireEvent.change(screen.getByLabelText('股數'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('成交價'), { target: { value: '100' } });
    fireEvent.click(screen.getByLabelText('加入這筆成交'));
    expect(onAdd.mock.calls[0][0].name).toBe('和泰車');
  });

  it('resolver 失敗（reject）時也不得把 code 寫進名稱欄位', async () => {
    const { resolveStockName } = await import('@/lib/stockNameResolver');
    (resolveStockName as unknown as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(async () => { throw new Error('boom'); });
    renderForm();
    fireEvent.change(codeInput(), { target: { value: '2207' } });
    await flush(); // resolver 已發出、尚未回應（現場的「約 320ms」）
    await waitFor(() => expect(nameInput().value).toBe(''));
  });

  it('resolver 成功且名稱欄位為空、使用者未編輯 → 仍照常自動帶入', async () => {
    const { release } = await pendingResolver();
    renderForm();
    fireEvent.change(codeInput(), { target: { value: '2330' } });
    await flush();
    await release('台積電');
    await waitFor(() => expect(nameInput().value).toBe('台積電'));
  });

  it('既有契約保留：code A→B，A 的慢回應不得回填', async () => {
    const { resolveStockName } = await import('@/lib/stockNameResolver');
    const fn = resolveStockName as unknown as ReturnType<typeof vi.fn>;
    let releaseA: (v: string) => void = () => {};
    fn.mockImplementationOnce(() => new Promise<string>((res) => { releaseA = res; }));
    fn.mockImplementationOnce(async () => 'AMD Inc');

    renderForm();
    fireEvent.change(codeInput(), { target: { value: '2330' } });
    await flush();
    fireEvent.change(codeInput(), { target: { value: 'AMD' } });
    await waitFor(() => expect(nameInput().value).toBe('AMD Inc'));
    await act(async () => {
      releaseA('台積電');
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(nameInput().value).toBe('AMD Inc');
  });

  it('送出重置後，前一列的晚到 resolver 不得污染下一列', async () => {
    const { release } = await pendingResolver();
    renderForm();
    fireEvent.change(codeInput(), { target: { value: '2207' } });
    await flush(); // resolver 已發出、尚未回應（現場的「約 320ms」）
    fireEvent.change(nameInput(), { target: { value: '和泰車' } });
    fireEvent.change(screen.getByLabelText('股數'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('成交價'), { target: { value: '100' } });
    fireEvent.click(screen.getByLabelText('加入這筆成交'));
    await release('和泰車');
    expect(nameInput().value).toBe('');
    expect(codeInput().value).toBe('');
  });
});
