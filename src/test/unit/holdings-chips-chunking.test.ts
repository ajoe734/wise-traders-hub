/**
 * Stage 3B / S3B-0 RED test — 可見持倉 > 30 檔時的批次分塊
 *
 * 契約（v4.1 §S3B-D）：卡片渲染時最多發出 ceil(n/30) 個 bounded batch 請求，
 * 且所有可見代號都必須被涵蓋（不得靜默截斷）。31 檔 → 2 個請求、代號聯集 = 31。
 *
 * 目前預期 RED，失敗點：useChipsBatch 用 `dedupeCodes(codes).slice(0, 30)`，
 * 31 檔只發 1 個請求且第 31 檔永遠拿不到資料。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fetchChipsBatch = vi.fn();

vi.mock('@/checkup/lib/chipsRepository', () => ({
  fetchChipsBatch: (...args: unknown[]) => fetchChipsBatch(...args),
  prefetchChipsPayload: vi.fn(),
}));
vi.mock('@/checkup/hooks/useSparklines', () => ({ prefetchSparkline: vi.fn() }));
vi.mock('@/checkup/contexts/CheckupModeContext', () => ({
  useCheckupMode: () => ({ isDemo: false }),
}));

import { useChipsBatch } from '@/checkup/hooks/useChipsBatch';

const CODES = Array.from({ length: 31 }, (_, i) => String(1101 + i));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('S3B RED · chips 批次分塊（31 檔）', () => {
  beforeEach(() => {
    fetchChipsBatch.mockReset();
    fetchChipsBatch.mockImplementation(async (codes: string[]) => ({
      results: Object.fromEntries(codes.map((c) => [c, { stock_id: c }])),
      errors: {},
      served_at: new Date().toISOString(),
    }));
  });

  it('31 檔必須發出 2 個 bounded 請求且代號聯集完整', async () => {
    // useChipsBatch 的 keyRef 初始化為首次 key，必須「變更」可見代號才會觸發批次
    const { rerender } = renderHook(
      ({ codes }: { codes: string[] }) => useChipsBatch({ codes }),
      { wrapper, initialProps: { codes: [] as string[] } },
    );
    rerender({ codes: CODES });

    await waitFor(() => expect(fetchChipsBatch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));

    const calls = fetchChipsBatch.mock.calls;
    const sizes = calls.map((c) => (c[0] as string[]).length);
    expect(
      calls.length,
      `RED: 31 檔應分成 2 個請求，實得 ${calls.length} 個（sizes=${sizes.join(',')}）—— useChipsBatch 仍是 slice(0, 30)`,
    ).toBe(2);

    const union = new Set(calls.flatMap((c) => c[0] as string[]));
    expect(
      union.size,
      `RED: 代號聯集應為 31，實得 ${union.size} —— 第 31 檔被靜默截斷`,
    ).toBe(31);
    for (const s of sizes) expect(s).toBeLessThanOrEqual(30);
  });
});
