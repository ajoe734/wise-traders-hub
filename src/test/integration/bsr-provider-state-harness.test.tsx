/**
 * BSR 授權狀態呈現回歸（走 production seam，不複製條件）。
 * 覆蓋：不再出現「券商分點券商分點」、terminal 無假回推區間、transient 有真實區間、
 *      法人與 BSR freshness 分離、CAPTCHA fallback fail-closed、fixture 不打網路。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import BsrProviderStateHarnessEntry, { HARNESS_MARKER } from '@/pages/BsrProviderStateHarnessEntry';

const txt = (id: string) => screen.getByTestId(id).textContent ?? '';

function pick(id: string) {
  fireEvent.click(screen.getByTestId(`scenario-${id}`));
}

let fetchSpy: ReturnType<typeof vi.fn>;
let xhrSpy: ReturnType<typeof vi.fn>;
let beaconSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cleanup();
  fetchSpy = vi.fn();
  xhrSpy = vi.fn();
  beaconSpy = vi.fn();
  window.fetch = fetchSpy as unknown as typeof window.fetch;
  XMLHttpRequest.prototype.open = xhrSpy as unknown as typeof XMLHttpRequest.prototype.open;
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beaconSpy });
  render(<BsrProviderStateHarnessEntry />);
});

function assertNoNetwork() {
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(xhrSpy).not.toHaveBeenCalled();
  expect(beaconSpy).not.toHaveBeenCalled();
  expect(txt('blocked-network-calls')).toBe('0');
}

describe('BSR provider state harness', () => {
  it('顯示 marker', () => {
    expect(txt('harness-marker')).toBe(HARNESS_MARKER);
  });

  it('terminal：卡片說「更新暫停 · 最後成功」，不出現重複的「券商分點」字樣', () => {
    pick('terminal_provider_rejected');
    const secondary = txt('card-secondary');
    expect(secondary).toBe('券商分點更新暫停 · 最後成功 2026/08/14');
    expect(secondary).not.toMatch(/FinMind|Sponsor|授權/);
    // 整行（主要＋次要）只能出現一次「券商分點」
    const line = `${txt('card-primary')} · ${secondary}`;
    expect(line.split('券商分點').length - 1).toBe(1);
    assertNoNetwork();
  });

  it('terminal：抽屜只顯示更新暫停與最後成功日，不暴露授權資訊', () => {
    pick('terminal_provider_rejected');
    expect(txt('seg-bsr-state')).toBe('unavailable_unsupported');
    expect(txt('seg-bsr-text')).toBe('券商分點更新暫停 · 最後成功 2026/08/14');
    expect(txt('seg-bsr-text')).not.toMatch(/FinMind|Sponsor|授權/);
    expect(txt('seg-bsr-as-of')).toBe('2026/08/14');
  });

  it('terminal：不得顯示假的回推區間或授權資訊', () => {
    pick('terminal_provider_rejected');
    expect(txt('retry-note-kind')).toBe('none_since_entitlement');
    expect(txt('retry-note-text')).toBe('更新暫停期間未再嘗試');
    expect(txt('retry-note-text')).not.toContain('授權');
    expect(txt('retry-note-text')).not.toContain('~');
    expect(txt('retry-note-text')).not.toContain('2026/08/17');
  });

  it('transient：有完整 from/to 時顯示真實回推區間與天數', () => {
    pick('transient_with_range');
    expect(txt('retry-note-kind')).toBe('range');
    expect(txt('retry-note-text')).toBe('2026/09/11 ~ 2026/09/16（共 4 個日期）');
  });

  it('法人 freshness 與 BSR OUTAGE 完全分離', () => {
    pick('terminal_provider_rejected');
    expect(txt('seg-institutional-state')).toBe('fresh');
    expect(txt('seg-institutional-as-of')).toBe('2026/09/16');
    expect(txt('card-primary')).toContain('法人 2026/09/16');
    expect(txt('seg-bsr-state')).toBe('unavailable_unsupported');
    expect(txt('seg-bsr-as-of')).toBe('2026/08/14');
  });

  it('CAPTCHA fallback：terminal 時 fail-closed，非 terminal 時才允許', () => {
    pick('terminal_provider_rejected');
    expect(txt('captcha-allowed')).toBe('false');
    expect(txt('captcha-reason')).toBe('captcha_fallback_disabled');
    pick('transient_with_range');
    expect(txt('captcha-allowed')).toBe('true');
    expect(txt('captcha-reason')).toBe('');
  });

  it('fresh 與 stale_no_failure 情境', () => {
    pick('fresh');
    expect(txt('seg-bsr-state')).toBe('fresh');
    expect(txt('card-secondary')).toBe('');
    expect(txt('retry-note-kind')).toBe('no_failure_record');
    pick('stale_no_failure');
    expect(txt('seg-bsr-state')).toBe('lagging');
    expect(txt('seg-bsr-text')).toBe('2026/09/10（落後 4 個交易日）');
  });

  it('not_applicable：ETF 不適用，且不打任何網路', () => {
    pick('not_applicable');
    expect(txt('card-kind')).toBe('not_applicable');
    expect(txt('seg-bsr-state')).toBe('ineligible');
    assertNoNetwork();
  });
});
