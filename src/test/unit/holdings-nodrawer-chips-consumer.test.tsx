/**
 * Stage D · 不開抽屜也要看得到 BSR 狀態（真有 consumer 訂閱）
 *
 * 契約（Plan v3 §D/§G）：
 *   1. 持倉卡片樹本身必須訂閱 chips 快取，不能只有抽屜是 consumer。
 *   2. 卡片渲染 data-testid="holding-card-bsr" 與 data-bsr-state / data-bsr-as-of。
 *   3. 狀態→文案走 canonical 映射；terminal 顯示「籌碼資料暫時無法取得」＋最後可得日期，
 *      不得留白、不得出現舊禁止文案，也絕不觸碰 quantity / value / ROI。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import HoldingCardBsr from '@/checkup/components/freecheckup/_ui/holdingCard/HoldingCardBsr';
import { chipsBatchStatusKey } from '@/checkup/hooks/useChipsBatch';
import { chipsQueryKey } from '@/checkup/hooks/useTwChipsDetail';

function src(rel: string): string {
  try { return readFileSync(resolve(process.cwd(), rel), 'utf8'); } catch { return ''; }
}

const CARD = src('src/checkup/components/freecheckup/HoldingCard.tsx');
const BSR = src('src/checkup/components/freecheckup/_ui/holdingCard/HoldingCardBsr.tsx');
const CARD_TREE = [CARD, BSR].join('\n');

afterEach(() => cleanup());

function renderState(setup: (qc: QueryClient) => void, code = '2330') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  setup(qc);
  render(
    <QueryClientProvider client={qc}>
      <HoldingCardBsr code={code} />
    </QueryClientProvider>,
  );
  return screen.getByTestId('holding-card-bsr');
}

describe('Stage D · 卡片層（無抽屜）是 chips consumer', () => {
  it('卡片樹必須訂閱 chips 快取', () => {
    expect(/chipsQueryKey|useTwChipsDetail|chipsBatchStatusKey/.test(CARD_TREE)).toBe(true);
    expect(CARD.includes('HoldingCardBsr')).toBe(true);
  });

  it('卡片必須渲染 holding-card-bsr 契約節點', () => {
    expect(CARD_TREE.includes('holding-card-bsr')).toBe(true);
    expect(/data-bsr-state/.test(CARD_TREE)).toBe(true);
    expect(/data-bsr-as-of/.test(CARD_TREE)).toBe(true);
  });

  it('terminal payload → unavailable_unsupported 與最後可得日期，文案不留白', () => {
    const node = renderState((qc) => {
      qc.setQueryData(chipsQueryKey('2330'), {
        payload: { stock_id: '2330', bsr_as_of: '2026-08-14', bsr_provider_state: 'terminal_provider_rejected' },
        stampVer: null, bytes: 0, durationMs: 0,
      });
      qc.setQueryData(chipsBatchStatusKey('2330'), { kind: 'ok', runId: 1, at: Date.now() });
    });
    expect(node.getAttribute('data-bsr-state')).toBe('unavailable_unsupported');
    expect(node.getAttribute('data-bsr-as-of')).toBe('2026-08-14');
    expect(node.textContent).toBe('籌碼資料暫時無法取得 · 顯示最後可得資料 2026/08/14');
    for (const forbidden of ['上游來源中止', '此股票不支援', 'FinMind', 'HTTP', 'sponsor']) {
      expect(node.textContent).not.toContain(forbidden);
    }
  });

  it('terminal payload + batch error → 仍是 unavailable_unsupported（權威不被蓋掉）', () => {
    const node = renderState((qc) => {
      qc.setQueryData(chipsQueryKey('2330'), {
        payload: { stock_id: '2330', bsr_as_of: null, bsr_provider_state: 'terminal_provider_rejected' },
        stampVer: null, bytes: 0, durationMs: 0,
      });
      qc.setQueryData(chipsBatchStatusKey('2330'), { kind: 'error', runId: 2, at: Date.now(), reason: 'chunk_failed' });
    });
    expect(node.getAttribute('data-bsr-state')).toBe('unavailable_unsupported');
    expect(node.textContent).toBe('籌碼資料暫時無法取得');
  });

  it('stale payload + batch error → partial_error（不得標 available）', () => {
    const node = renderState((qc) => {
      qc.setQueryData(chipsQueryKey('2330'), {
        payload: { stock_id: '2330', bsr_as_of: '2026-08-14', bsr_freshness_status: 'fresh' },
        stampVer: null, bytes: 0, durationMs: 0,
      });
      qc.setQueryData(chipsBatchStatusKey('2330'), { kind: 'error', runId: 3, at: Date.now() });
    });
    expect(node.getAttribute('data-bsr-state')).toBe('partial_error');
    expect(node.textContent).toContain('2026/08/14');
  });

  it('stale payload + pending → syncing', () => {
    const node = renderState((qc) => {
      qc.setQueryData(chipsQueryKey('2330'), {
        payload: { stock_id: '2330', bsr_as_of: '2026-08-14', bsr_freshness_status: 'fresh' },
        stampVer: null, bytes: 0, durationMs: 0,
      });
      qc.setQueryData(chipsBatchStatusKey('2330'), { kind: 'pending', runId: 4, at: Date.now() });
    });
    expect(node.getAttribute('data-bsr-state')).toBe('syncing');
    expect(node.textContent).toBe('籌碼資料更新中');
  });

  it('美股代號 → not_applicable「籌碼資料不適用」，不得出現 ETF／權證文案', () => {
    for (const code of ['ABC', 'ORCL', 'AMD']) {
      cleanup();
      const node = renderState((qc) => {
        qc.setQueryData(chipsBatchStatusKey(code), { kind: 'not_applicable', runId: 1, at: Date.now() });
      }, code);
      expect(node.getAttribute('data-bsr-state')).toBe('not_applicable');
      expect(node.textContent).toBe('籌碼資料不適用');
      for (const forbidden of ['ETF', '權證', '受益憑證']) {
        expect(node.textContent).not.toContain(forbidden);
      }
    }
  });

  it('payload providerState=ineligible → ETF／權證文案（唯一合法出處）', () => {
    const node = renderState((qc) => {
      qc.setQueryData(chipsQueryKey('0050'), {
        payload: { stock_id: '0050', bsr_as_of: null, bsr_provider_state: 'ineligible' },
        stampVer: null, bytes: 0, durationMs: 0,
      });
      qc.setQueryData(chipsBatchStatusKey('0050'), { kind: 'ok', runId: 1, at: Date.now() });
    }, '0050');
    expect(node.getAttribute('data-bsr-state')).toBe('ineligible');
    expect(node.textContent).toBe('不適用（ETF／權證／受益憑證）');
  });
});

/* ── v4.2：normalization boundary、零請求、卡片 testid 契約 ───────────── */
describe('Stage D · 卡片層 normalization 與零請求', () => {
  it('raw lowercase / 空白代號在元件邊界正規化後仍讀得到快取', () => {
    const node = renderState((qc) => {
      qc.setQueryData(chipsQueryKey('00637L'), {
        payload: { stock_id: '00637L', bsr_as_of: '2026-08-14', bsr_provider_state: 'terminal_provider_rejected' },
        stampVer: null, bytes: 0, durationMs: 0,
      });
      qc.setQueryData(chipsBatchStatusKey('00637L'), { kind: 'ok', runId: 1, at: Date.now() });
    }, ' 00637l ');
    expect(node.getAttribute('data-bsr-state')).toBe('unavailable_unsupported');
    expect(node.getAttribute('data-bsr-as-of')).toBe('2026-08-14');
  });

  it('卡片層 consumer 不得發出任何 fetch（RPC / edge 皆 0）', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    renderState((qc) => {
      qc.setQueryData(chipsQueryKey('2330'), {
        payload: { stock_id: '2330', bsr_as_of: '2026-08-14', bsr_provider_state: 'terminal_provider_rejected' },
        stampVer: null, bytes: 0, durationMs: 0,
      });
    });
    expect(spy).toHaveBeenCalledTimes(0);
    spy.mockRestore();
  });

  it('HoldingCard 必須提供 390px 版面斷言用的 testid 錨點', () => {
    for (const id of ['card-qty', 'card-price', 'card-pnl', 'card-bottom-row']) {
      expect(CARD.includes(id), `HoldingCard 缺少 ${id}`).toBe(true);
    }
  });
});
