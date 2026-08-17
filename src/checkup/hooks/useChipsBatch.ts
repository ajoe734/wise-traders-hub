/**
 * useChipsBatch — 候選 D：批次預載可見持倉的籌碼資料，並提供 hover 單股預載。
 *
 * 為什麼存在：持倉牆一次可能顯示 30 檔，若等使用者點開抽屜才個別呼叫
 * tw-chips-detail，會產生 N+1 次 edge handshake。此 hook 在可見代號改變時
 * 發一次 POST /tw-chips-detail（stock_ids），把結果填入 TanStack Query 快取；hover 則觸發單股
 * 補漏（含 sparkline），讓抽屜開啟幾乎立即有資料。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchChipsBatch, prefetchChipsPayload } from '@/checkup/lib/chipsRepository';
import { prefetchSparkline } from '@/checkup/hooks/useSparklines';
import { chipsQueryKey } from '@/checkup/hooks/useTwChipsDetail';
import { useCheckupMode } from '@/checkup/contexts/CheckupModeContext';
import type { ChipsFetchResult } from '@/checkup/lib/chipsRepository';

function isValidCode(code: string): boolean {
  return /^\d{4,6}[A-Z]?$/i.test(code);
}

function dedupeCodes(codes: string[]): string[] {
  const seen = new Set<string>();
  return codes
    .map((c) => String(c).trim())
    .filter((c) => {
      if (!c || !isValidCode(c) || seen.has(c)) return false;
      seen.add(c);
      return true;
    });
}

export interface UseChipsBatchOptions {
  codes: string[];
  enabled?: boolean;
  isViewAs?: boolean;
}

export function useChipsBatch({ codes, enabled = true, isViewAs = false }: UseChipsBatchOptions) {
  const qc = useQueryClient();
  const { isDemo } = useCheckupMode();
  const validCodes = dedupeCodes(codes).slice(0, 30);
  const key = validCodes.sort().join(',');
  const keyRef = useRef(key);
  const [prefetched, setPrefetched] = useState<Set<string>>(new Set());

  // 可見卡片變動時批次預載。
  // Demo 也要預載：前端自身不 enqueue；但舊 tw-chips-detail 後端仍會 rebuild／寫 inflight，
  // 真正的 read-only 端點是 side-by-side 的 tw-chips-detail-v2（production 尚未切換）。
  // 讓 Demo 使用者一開抽屜就有背景 cron 已備妥的資料，而不是靠 lazy 回補。
  useEffect(() => {
    if (!enabled || keyRef.current === key) return;
    keyRef.current = key;
    if (!validCodes.length) return;

    let cancelled = false;
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetchChipsBatch(validCodes, {
          signal: ac.signal,
          telemetry: { source: isDemo ? 'visible_batch_demo' : 'visible_batch', isViewAs },
        });
        if (cancelled) return;
        const now = Date.now();
        for (const [code, payload] of Object.entries(res.results)) {
          const stampVer = payload?._cache_meta?.stamp_ver ?? null;
          qc.setQueryData<ChipsFetchResult>(chipsQueryKey(code), { payload, stampVer, bytes: 0, durationMs: 0 }, { updatedAt: now });
        }
        setPrefetched(new Set(Object.keys(res.results)));
      } catch {
        // silent: prefetch is best-effort
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [enabled, isDemo, key, qc, isViewAs]);

  const prefetch = useCallback(
    async (code: string) => {
      if (!isValidCode(code)) return;

      const cached = qc.getQueryData<ChipsFetchResult>(chipsQueryKey(code));
      if (cached) return;

      // 籌碼 + 走勢並行預載
      await Promise.all([
        (async () => {
          const result = await prefetchChipsPayload(code, {
            telemetry: { source: 'hover_prefetch', isViewAs },
          });
          if (result) {
            qc.setQueryData<ChipsFetchResult>(chipsQueryKey(code), result, { updatedAt: Date.now() });
          }
        })(),
        prefetchSparkline(code),
      ]);
    },
    [isDemo, qc, isViewAs],
  );

  return { prefetch, prefetched };
}

export default useChipsBatch;
