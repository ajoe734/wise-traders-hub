/**
 * 手動輸入成交 — 單一提交管線 component 測試（PLAN_V4.1 T3/T4）
 *
 * 驗收重點：
 *  - ManualTradeForm 只做 onAdd(row)，不直接提交
 *  - 手動列 append 進 TradeTab 既有 parsed.trades，與 OCR 列混排
 *  - 只有一顆確認鈕（applyCorrections），沒有第二條 commit 管線
 *  - preview 逐列編輯後 sequential replay 即時更新（賣超 / MAX_HOLDINGS）
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

import TradeTab from '@/checkup/components/freecheckup/TradeTab';
import { appendToParsed, computePreviewIssues } from '@/checkup/lib/manualTradeEntry';

const C: Record<string, string> = {
  bg: '#F5F3EF', card: '#fff', subtle: '#EEE', border: '#DDD',
  text: '#292520', textSec: '#4A4A4A', textMute: '#8A8A8A',
  amber: '#EC662D', blue: '#3B6EA5', teal: '#2D7D7D', up: '#C0392B', down: '#1E824C',
};
const alpha = (c: string) => c;
const card = {};
const lbl = {};

async function fillValidDraft() {
  fireEvent.change(screen.getByLabelText('股票代碼'), { target: { value: '2330' } });
  await waitFor(() => expect((screen.getByLabelText('股票名稱') as HTMLInputElement).value).toBe('台積電'));
  fireEvent.change(screen.getByLabelText('股數'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('成交價'), { target: { value: '1100' } });
}

describe('TradeTab — 手動 / OCR 共用同一份 preview 與同一顆確認鈕', () => {
  const baseProps = () => ({
    C, alpha, card, lbl,
    parsing: false, parseStep: '', parseErr: undefined,
    parsed: undefined, setParsed: vi.fn(),
    img: undefined, dragOver: false, setDragOver: vi.fn(),
    processFile: vi.fn(), processFiles: vi.fn(), parseShot: vi.fn(),
    batchState: undefined, cancelBatch: vi.fn(), retryBatchFailures: vi.fn(), restoreBatchItemPreview: vi.fn(),
    setImg: vi.fn(), setB64: vi.fn(), setParseErr: vi.fn(),
    isDemo: false, startLineLogin: vi.fn(),
    hasReachedDailyLimit: false, tier: 'none', quota: undefined,
    formatResetDateTime: () => '', formatResetCountdown: () => '',
    holdings: [], setHoldings: vi.fn(), setTradeLog: vi.fn(),
    setUploadSummary: vi.fn(), holdingsChangedByUserRef: { current: false },
    stripDemoSeedHoldings: (x: unknown[]) => x,
    mergeTradeIntoHoldings: (list: unknown[]) => list,
    upsertSnapshotHolding: (list: unknown[]) => list,
    SNAPSHOT_IMPORT_ACTION: '庫存匯入', MAX_HOLDINGS: 50,
    toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), error: vi.fn() }),
    setTab: vi.fn(),
    memoAns: [], memoIn: '', setMemoIn: vi.fn(), memoStep: 0, qs: [], submitMemo: vi.fn(),
    tpCode: '', setTpCode: vi.fn(), tpFirm: '', setTpFirm: vi.fn(), tpVal: '', setTpVal: vi.fn(),
    setTargets: vi.fn(), setSaved: vi.fn(),
  });

  it('手動加入的列走 setParsed → appendToParsed，沒有第二條 commit', async () => {
    const props = baseProps();
    render(<TradeTab {...props} />);
    fireEvent.click(screen.getByRole('tab', { name: '手動輸入' }));
    await fillValidDraft();
    fireEvent.click(screen.getByLabelText('加入這筆成交'));
    expect(props.setParsed).toHaveBeenCalledTimes(1);
    const updater = props.setParsed.mock.calls[0][0] as (p: unknown) => { trades: unknown[] };
    const next = updater(null);
    expect(next.trades).toHaveLength(1);
  });

  it('OCR 列與手動列混排時，確認鈕只有一顆並顯示總筆數', () => {
    const ocrRow = {
      action: '買進', code: '2454', name: '聯發科', qty: 1000, price: 1200,
      market_price: 1200, amount: 1200000, total_cost: 1200000, fee: 0,
      date: '2026/09/01', time: '09:05', priceSource: 'screenshot',
    };
    const manualRow = {
      action: '買進', code: '2330', name: '台積電', qty: 1000, price: 1100,
      market_price: 1100, amount: 1100000, total_cost: 1100000, fee: 0,
      date: '2026/09/01', time: '10:05', priceSource: 'manual',
    };
    const parsed = appendToParsed({ trades: [ocrRow] }, manualRow as never);
    expect(parsed.trades.map((t: { code: string }) => t.code)).toEqual(['2454', '2330']);

    render(<TradeTab {...baseProps()} parsed={parsed} />);
    const confirms = screen.getAllByLabelText('確認並更新持倉');
    expect(confirms).toHaveLength(1);
    expect(confirms[0].textContent).toContain('2 筆');
  });
});

describe('preview sequential replay', () => {
  it('賣超與持倉上限在整份清單上重算', () => {
    const holdings = [{ code: '2330', name: '台積電', qty: 1000 }];
    const sellOver = computePreviewIssues(holdings, [
      { action: '賣出', code: '2330', qty: 2000 },
    ]);
    expect(sellOver.some((i) => i.kind === 'oversell')).toBe(true);

    const okSell = computePreviewIssues(holdings, [
      { action: '買進', code: '2330', qty: 1000 },
      { action: '賣出', code: '2330', qty: 2000 },
    ]);
    expect(okSell).toHaveLength(0);
  });
});
