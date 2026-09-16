/**
 * UNPUBLISHED_JOURNAL_EDIT_ISOLATION_V1 — Preview harness render/integration 測試。
 *
 * 真實 render harness 頁面、點場景、輸入標題與參考價、按儲存，驗證：
 *  - marker 顯示
 *  - title-price-edit / cash-zero-edit：save_status=ok、mutation_calls=1、輸入新值保留
 *  - ledger-isolation：五組帳本指紋 before/after 完全相同
 *  - published-rejected：blocked、mutation/rpc 皆 0
 *  - cross-tenant-rejected：forbidden 友善錯誤、mutation 0、輸入保留
 *  - missing-rpc：友善錯誤、mutation 0、輸入保留
 *  - network guard：fetch / XHR / sendBeacon 從未被實際呼叫（production adapter 未觸發）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import PendingJournalEditHarnessEntry, {
  HARNESS_MARKER,
  LEDGER_GROUPS,
} from '@/pages/PendingJournalEditHarnessEntry';

const realFetch = vi.fn();
const realOpen = vi.fn();
const realBeacon = vi.fn();

beforeEach(() => {
  realFetch.mockClear();
  realOpen.mockClear();
  realBeacon.mockClear();
  (window as any).fetch = realFetch;
  (window as any).XMLHttpRequest.prototype.open = realOpen;
  (window.navigator as any).sendBeacon = realBeacon;
});

afterEach(() => cleanup());

const tid = (id: string) => screen.getByTestId(id);

async function runScenario(key: string, topic: string, price: string) {
  render(<PendingJournalEditHarnessEntry />);
  fireEvent.click(tid(`scenario-${key}`));
  fireEvent.change(tid('input-teaching-topic'), { target: { value: topic } });
  fireEvent.change(tid('input-price-hint'), { target: { value: price } });
  fireEvent.click(tid('btn-save'));
  await waitFor(() => expect(tid('save-status').textContent).not.toBe(''));
}

function expectNoRealNetwork() {
  expect(realFetch).not.toHaveBeenCalled();
  expect(realOpen).not.toHaveBeenCalled();
  expect(realBeacon).not.toHaveBeenCalled();
  expect(tid('blocked-network-calls').textContent).toBe('0');
}

describe('pending journal edit preview harness', () => {
  it('顯示 marker 與 fixture mode', () => {
    render(<PendingJournalEditHarnessEntry />);
    expect(tid('harness-marker').textContent).toBe(HARNESS_MARKER);
    expect(tid('harness-mode').textContent).toContain('fixture-mode');
  });

  it('title-price-edit：成功更新且輸入新值保留', async () => {
    await runScenario('title-price-edit', '新主題A', '222.5');
    expect(tid('save-status').textContent).toBe('ok');
    expect(tid('mutation-calls').textContent).toBe('1');
    expect(tid('value-teaching-topic').textContent).toBe('新主題A');
    expect(tid('value-price-hint').textContent).toBe('222.5');
    expectNoRealNetwork();
  });

  it('cash-zero-edit：可用資金 0 且無持倉仍成功', async () => {
    await runScenario('cash-zero-edit', '新主題B', '333.5');
    expect(tid('fixture-available-cash').textContent).toBe('0');
    expect(tid('fixture-holdings').textContent).toBe('0');
    expect(tid('save-status').textContent).toBe('ok');
    expect(tid('mutation-calls').textContent).toBe('1');
    expectNoRealNetwork();
  });

  it('ledger-isolation：五組帳本指紋 before/after 相同', async () => {
    await runScenario('ledger-isolation', '新主題C', '444.5');
    expect(tid('save-status').textContent).toBe('ok');
    expect(tid('ledger-same').textContent).toBe('true');
    expect(LEDGER_GROUPS.length).toBe(5);
    for (const g of LEDGER_GROUPS) {
      const before = tid(`fp-${g}-before`).textContent;
      const after = tid(`fp-${g}-after`).textContent;
      expect(before).toBeTruthy();
      expect(after).toBe(before);
    }
    expectNoRealNetwork();
  });

  it('published-rejected：擋下且不呼叫 RPC', async () => {
    await runScenario('published-rejected', '新主題D', '555.5');
    expect(tid('save-status').textContent).toBe('blocked');
    expect(tid('mutation-calls').textContent).toBe('0');
    expect(tid('rpc-calls').textContent).toBe('0');
    expectNoRealNetwork();
  });

  it('cross-tenant-rejected：forbidden 友善錯誤、零寫入、輸入保留', async () => {
    await runScenario('cross-tenant-rejected', '新主題E', '666.5');
    expect(tid('save-status').textContent).toBe('error');
    expect(tid('save-message').textContent).toContain('沒有權限');
    expect(tid('mutation-calls').textContent).toBe('0');
    expect(tid('value-teaching-topic').textContent).toBe('新主題E');
    expect(tid('value-price-hint').textContent).toBe('666.5');
    expectNoRealNetwork();
  });

  it('missing-rpc：友善錯誤、零寫入、輸入保留', async () => {
    await runScenario('missing-rpc', '新主題F', '777.5');
    expect(tid('save-status').textContent).toBe('error');
    expect(tid('save-message').textContent).toContain('尚未啟用');
    expect(tid('mutation-calls').textContent).toBe('0');
    expect(tid('value-teaching-topic').textContent).toBe('新主題F');
    expect(tid('value-price-hint').textContent).toBe('777.5');
    expectNoRealNetwork();
  });
});
