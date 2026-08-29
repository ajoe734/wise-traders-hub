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
import { render, renderHook, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import HoldingCardBsr from '@/checkup/components/freecheckup/_ui/holdingCard/HoldingCardBsr';
import { chipsBatchStatusKey } from '@/checkup/hooks/useChipsBatch';
import { chipsQueryKey, useTwChipsDetail } from '@/checkup/hooks/useTwChipsDetail';

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

/* ── DEMO_BATCH_GATE_P0：Demo 也必須啟用 visible-card 預載 ─────────────── */
const WORKBENCH = src('src/checkup/components/freecheckup/HoldingsWorkbench.tsx');

describe('DEMO_BATCH_GATE_P0 · Workbench 不得用 isDemo 關掉 chips batch', () => {
  it('原始碼不得再出現 enabled: !isDemo（含空白變體）', () => {
    expect(/enabled\s*:\s*!\s*isDemo/.test(WORKBENCH)).toBe(false);
    expect(WORKBENCH.includes('isDemo')).toBe(false);
    expect(/useChipsBatch\(\{\s*codes:\s*sparklineCodes,\s*enabled:\s*true\s*\}\)/.test(WORKBENCH)).toBe(true);
  });

  it('demo/no-drawer 契約下，Workbench 實際以 enabled=true 呼叫 useChipsBatch', async () => {
    const calls: Array<{ codes: string[]; enabled: boolean }> = [];
    vi.resetModules();
    vi.doMock('@/checkup/hooks/useChipsBatch', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/checkup/hooks/useChipsBatch')>();
      return {
        ...actual,
        useChipsBatch: (args: { codes: string[]; enabled?: boolean }) => {
          calls.push({ codes: args.codes, enabled: args.enabled !== false });
          return { prefetch: () => {}, prefetched: new Set<string>() };
        },
      };
    });
    vi.doMock('@/checkup/hooks/useSparklines', () => ({
      useSparklines: () => ({ sparklines: {}, sparklineErrors: {} }),
    }));
    vi.doMock('@/checkup/contexts/CheckupModeContext', () => ({
      useCheckupMode: () => ({ isDemo: true }),
      CheckupModeProvider: ({ children }: { children: React.ReactNode }) => children,
    }));
    vi.doMock('@/checkup/components/freecheckup/HoldingCard', () => ({
      default: ({ code }: { code: string }) => <div data-testid={`card-${code}`}>{code}</div>,
    }));

    const { default: HoldingsWorkbench } = await import(
      '@/checkup/components/freecheckup/HoldingsWorkbench'
    );

    const holdings = [
      { code: '2330', name: '台積電', qty: 1000, price: 110, cost: 100 },
      { code: '2317', name: '鴻海', qty: 1000, price: 110, cost: 100 },
    ];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <HoldingsWorkbench
          WB={{}}
          H={{}}
          expandedDecision={null}
          displayed={holdings}
          sorted={holdings}
          orderedDisplayed={holdings}
          variantsMap={new Map()}
          decisionsMap={new Map()}
          targets={{}}
          avgTarget={{}}
          STOCK_META={{}}
          overrides={{}}
          holdingSyncStates={{}}
          normalizedEvents={[]}
          totalVal={0}
          sortBy="code"
          sortDir="asc"
          cardGridCols={2}
          viewMode="card"
          showAll={false}
          tradeLog={[]}
          handleHoldingCardSelect={() => {}}
          handleHoldingCardOpenDrawer={() => {}}
          handleReportMeta={() => {}}
          openHoldingDrawer={() => {}}
          setSortBy={() => {}}
          setSortDir={() => {}}
          setExpandedDecision={() => {}}
          setTab={() => {}}
          setSearchQ={() => {}}
          setFilterDecision={() => {}}
          setFilterThesis={() => {}}
          setFilterUrgency={() => {}}
          setFilterConflict={() => {}}
          setFilterPnl={() => {}}
          setFilterStrategy={() => {}}
          setSectorFilterPersisted={() => {}}
          setShowAll={() => {}}
        />
      </QueryClientProvider>,
    );

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.enabled === true)).toBe(true);
    expect(calls[calls.length - 1].codes).toEqual(['2330', '2317']);
    vi.doUnmock('@/checkup/hooks/useChipsBatch');
    vi.doUnmock('@/checkup/hooks/useSparklines');
    vi.doUnmock('@/checkup/contexts/CheckupModeContext');
    vi.doUnmock('@/checkup/components/freecheckup/HoldingCard');
    vi.resetModules();
  });
});

/* ── B1：抽屜／lifecycle 也必須用同一把 canonical key ─────────────────── */
const DETAIL_SRC = src('src/checkup/hooks/useTwChipsDetail.ts');

describe('B1 · drawer/lifecycle canonical cache key', () => {
  it('useTwChipsDetail 原始碼不得再自刻 trim-only 正規化', () => {
    expect(DETAIL_SRC.includes('normalizeStockCode(stockCode)')).toBe(true);
    expect(/String\(stockCode\)\.trim\(\)/.test(DETAIL_SRC)).toBe(false);
  });

  it('raw " 00637l " 讀到 batch 寫入的 ["tw-chips","00637L"]，且不建 lowercase 幽靈鍵', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chipsQueryKey('00637L'), {
      payload: { stock_id: '00637L', bsr_as_of: '2026-08-14', bsr_provider_state: 'terminal_provider_rejected' },
      stampVer: null, bytes: 0, durationMs: 0,
    });
    const { result } = renderHook(() => useTwChipsDetail(' 00637l '), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });

    expect(result.current.data?.stock_id).toBe('00637L');
    const keys = qc.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey));
    expect(keys).toContain('["tw-chips","00637L"]');
    expect(keys.some((k) => k.includes('00637l'))).toBe(false);
    cleanup();
  });

  it('raw lowercase 不得被 case-sensitive 檢查誤判 invalid（query 仍 enabled）', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chipsQueryKey('00637L'), {
      payload: { stock_id: '00637L', bsr_as_of: '2026-08-14', bsr_provider_state: 'terminal_provider_rejected' },
      stampVer: null, bytes: 0, durationMs: 0,
    });
    renderHook(() => useTwChipsDetail(' 00637l '), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    const q = qc.getQueryCache().find({ queryKey: chipsQueryKey('00637L') });
    expect(q?.observers.length ?? 0).toBeGreaterThan(0);
    cleanup();
  });
});
