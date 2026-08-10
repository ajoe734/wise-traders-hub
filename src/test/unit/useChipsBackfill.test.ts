/**
 * useChipsBackfill — 抽屜籌碼回補握手（走 Checkup Gateway seam）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  createFakeGateway,
  setCheckupGateway,
  resetCheckupGateway,
  CheckupGatewayError,
  type FakeGateway,
} from '@/checkup/lib/gateway';
import { useChipsBackfill, __resetChipsBackfillBudget } from '@/checkup/hooks/useChipsBackfill';

function mount(fake: FakeGateway, code: string | null = '2330') {
  setCheckupGateway(fake);
  return renderHook(() => useChipsBackfill(code));
}

describe('useChipsBackfill', () => {
  let fake: FakeGateway;

  beforeEach(() => {
    // module-level 去重／預算跨測試共用，必須逐案重置
    __resetChipsBackfillBudget();
    fake = createFakeGateway({
      functions: { 'tw-institutional-daily-sync': { ok: true } },
      rpcs: { enqueue_bsr_backfill: 42 },
    });
  });

  afterEach(() => {
    resetCheckupGateway();
    __resetChipsBackfillBudget();
  });

  it('兩條回補路徑都只透過 gateway 握手', async () => {
    const { result } = mount(fake);
    let res: Awaited<ReturnType<ReturnType<typeof useChipsBackfill>["requestBackfill"]>>;
    await act(async () => {
      res = await result.current.requestBackfill();
    });

    expect(fake.calls.invoke).toEqual([
      { name: 'tw-institutional-daily-sync', body: { mode: 'backfill_stock', stock_id: '2330', days: 60 } },
    ]);
    expect(fake.calls.rpc).toEqual([
      { fn: 'enqueue_bsr_backfill', args: { p_stock_id: '2330', p_days: 60 } },
    ]);
    expect(fake.calls.http).toHaveLength(0);
    expect(res).toEqual({ ok: true, bsrCount: 42 });
  });

  it('只要一條成功就算成功（BSR 失敗時 bsrCount 為 0）', async () => {
    fake = createFakeGateway({ functions: { 'tw-institutional-daily-sync': { ok: true } } }); // rpc 未註冊 → 失敗
    const { result } = mount(fake);
    let res: Awaited<ReturnType<ReturnType<typeof useChipsBackfill>["requestBackfill"]>>;
    await act(async () => {
      res = await result.current.requestBackfill();
    });
    expect(res).toEqual({ ok: true, bsrCount: 0 });
  });

  it('兩條都失敗時回傳錯誤訊息而不丟例外', async () => {
    fake = createFakeGateway({
      functions: { 'tw-institutional-daily-sync': new CheckupGatewayError('inst boom') },
      rpcs: { enqueue_bsr_backfill: new CheckupGatewayError('bsr boom') },
    });
    const { result } = mount(fake);
    let res: Awaited<ReturnType<ReturnType<typeof useChipsBackfill>["requestBackfill"]>>;
    await act(async () => {
      res = await result.current.requestBackfill();
    });
    expect(res).toMatchObject({ ok: false, bsrCount: 0, error: 'inst boom' });
  });

  it('沒有股票代號時不握手', async () => {
    const { result } = mount(fake, null);
    let res: Awaited<ReturnType<ReturnType<typeof useChipsBackfill>["requestBackfill"]>>;
    await act(async () => {
      res = await result.current.requestBackfill();
    });
    expect(res).toBeNull();
    expect(fake.calls.invoke).toHaveLength(0);
    expect(fake.calls.rpc).toHaveLength(0);
  });

  it('進行中不重複觸發，結束後 backfilling 歸位', async () => {
    const { result } = mount(fake);
    await act(async () => {
      await Promise.all([result.current.requestBackfill(), result.current.requestBackfill()]);
    });
    expect(fake.calls.invoke).toHaveLength(1);
    expect(result.current.backfilling).toBe(false);
  });
});
