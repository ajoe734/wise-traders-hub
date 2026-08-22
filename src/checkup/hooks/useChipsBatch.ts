/**
 * useChipsBatch — 候選 D：批次預載可見持倉的籌碼資料，並提供 hover 單股預載。
 *
 * 為什麼存在：持倉牆一次可能顯示 30+ 檔，若等使用者點開抽屜才個別呼叫
 * tw-chips-detail，會產生 N+1 次 edge handshake。此 hook 在可見代號改變時
 * 發出「每批最多 30 檔」的 bounded 請求，把結果填入 TanStack Query 快取；
 * hover 則觸發單股補漏（含 sparkline），讓抽屜開啟幾乎立即有資料。
 *
 * Stage D 修正：
 *   D2 分塊 — 舊版 `slice(0, 30)` 會讓第 31 檔以後**靜默消失**；改為 chunk(30)。
 *   代號正規化 — 一律走 repository 的 `normalizeStockCode` + `isTaiwanStockCode`，
 *                hook 不再自帶第二套 regex（`/i` 版本與 repository 不一致）。
 *   狀態可觀測 — 每檔在 `['tw-chips-batch-status', code]` 有 pending/ok/error/not_applicable，
 *                卡片層不用開抽屜就能誠實顯示狀態；partial chunk failure 只影響該批代號。
 *   race 防護 — 每輪 run 有 runId，chunk 回覆前先比對 runId，舊 run 一律丟棄不寫入。
 *
 * 注意：orchestration（分塊／狀態／runId／AbortController）只有這一套，
 * repository 不做第二套。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  fetchChipsBatch,
  prefetchChipsPayload,
  isTaiwanStockCode,
  normalizeStockCode,
  CHIPS_BATCH_MAX_STOCKS,
} from '@/checkup/lib/chipsRepository';
import { prefetchSparkline } from '@/checkup/hooks/useSparklines';
import { chipsQueryKey } from '@/checkup/hooks/useTwChipsDetail';
import { useCheckupMode } from '@/checkup/contexts/CheckupModeContext';
import type { ChipsFetchResult } from '@/checkup/lib/chipsRepository';

/** 卡片層訂閱的 batch 狀態 key（與 payload 快取 `['tw-chips', code]` 分離）。 */
export const chipsBatchStatusKey = (code: string) =>
  ['tw-chips-batch-status', code] as const;

export interface ChipsBatchStatus {
  /**
   * 'not_applicable' = 未通過台股 batch canonical validator（例：美股代號 ABC/ORCL/AMD、
   * 空字串、非法字元）。語意為「本地不送 batch」，**不等於** payload 的
   * providerState='ineligible'（ETF／權證／受益憑證）。
   */
  kind: 'pending' | 'ok' | 'error' | 'not_applicable';
  runId: number;
  at: number;
  reason?: 'chunk_failed' | 'per_code_error';
}

export function chunkCodes(codes: string[], size = CHIPS_BATCH_MAX_STOCKS): string[][] {
  const n = Math.max(1, Math.trunc(size) || 1);
  const out: string[][] = [];
  for (let i = 0; i < codes.length; i += n) out.push(codes.slice(i, i + n));
  return out;
}

/** 正規化 + 台股 canonical 驗證 + 去重；回傳 valid 與 rejected 兩份清單。 */
export function partitionCodes(codes: unknown[]): { valid: string[]; rejected: string[] } {
  const seen = new Set<string>();
  const valid: string[] = [];
  const rejected: string[] = [];
  const rejectedSeen = new Set<string>();
  for (const raw of codes ?? []) {
    const code = normalizeStockCode(raw);
    if (!code) continue;
    if (!isTaiwanStockCode(code)) {
      if (!rejectedSeen.has(code)) {
        rejectedSeen.add(code);
        rejected.push(code);
      }
      continue;
    }
    if (seen.has(code)) continue;
    seen.add(code);
    valid.push(code);
  }
  return { valid, rejected };
}

export interface UseChipsBatchOptions {
  codes: string[];
  enabled?: boolean;
  isViewAs?: boolean;
}

export function useChipsBatch({ codes, enabled = true, isViewAs = false }: UseChipsBatchOptions) {
  const qc = useQueryClient();
  const { isDemo } = useCheckupMode();
  const { valid, rejected } = partitionCodes(codes);
  // 送出順序保留可見順序（批次契約），只有 dep key 用排序後版本避免順序抖動重打。
  const validCodes = valid;
  const key = [...valid].sort().join(',');
  // 被拒代號本身可能含逗號（例：'2330,2317' 這種注入字串），
  // 因此 dep key 必須用 JSON，不能用 join(',') 再 split 還原。
  const rejectedKey = JSON.stringify([...rejected].sort());
  const keyRef = useRef(key);
  const runIdRef = useRef(0);
  const [prefetched, setPrefetched] = useState<Set<string>>(new Set());

  // 本地被拒代號：不打 API、不記事件，只寫本地可觀測狀態供卡片誠實顯示。
  useEffect(() => {
    const rejectedList: string[] = JSON.parse(rejectedKey);
    if (!rejectedList.length) return;
    const now = Date.now();
    for (const code of rejectedList) {
      if (!code) continue;
      qc.setQueryData<ChipsBatchStatus>(
        chipsBatchStatusKey(code),
        { kind: 'not_applicable', runId: runIdRef.current, at: now },
        { updatedAt: now },
      );
    }
  }, [rejectedKey, qc]);

  // 可見卡片變動時批次預載。
  // Demo 也要預載：前端自身不 enqueue；但舊 tw-chips-detail 後端仍會 rebuild／寫 inflight，
  // 真正的 read-only 端點是 side-by-side 的 tw-chips-detail-v2（production 尚未切換）。
  useEffect(() => {
    if (!enabled || keyRef.current === key) return;
    keyRef.current = key;
    if (!validCodes.length) return;

    runIdRef.current += 1;
    const myRun = runIdRef.current;
    const ac = new AbortController();
    const now0 = Date.now();

    // 新 run 先把所有代號寫成 pending，覆蓋上一輪殘留的 error。
    for (const code of validCodes) {
      qc.setQueryData<ChipsBatchStatus>(
        chipsBatchStatusKey(code),
        { kind: 'pending', runId: myRun, at: now0 },
        { updatedAt: now0 },
      );
    }

    const chunks = chunkCodes(validCodes, CHIPS_BATCH_MAX_STOCKS);
    (async () => {
      const done = new Set<string>();
      await Promise.all(
        chunks.map(async (chunk) => {
          try {
            const res = await fetchChipsBatch(chunk, {
              signal: ac.signal,
              telemetry: { source: isDemo ? 'visible_batch_demo' : 'visible_batch', isViewAs },
            });
            // race 硬閘：舊 run 的回覆一律丟棄，不寫入任何快取。
            if (myRun !== runIdRef.current) return;
            const now = Date.now();
            for (const [code, payload] of Object.entries(res.results)) {
              const stampVer = payload?._cache_meta?.stamp_ver ?? null;
              qc.setQueryData<ChipsFetchResult>(
                chipsQueryKey(code),
                { payload, stampVer, bytes: 0, durationMs: 0 },
                { updatedAt: now },
              );
              done.add(code);
            }
            for (const code of chunk) {
              const ok = Object.prototype.hasOwnProperty.call(res.results, code);
              qc.setQueryData<ChipsBatchStatus>(
                chipsBatchStatusKey(code),
                ok
                  ? { kind: 'ok', runId: myRun, at: now }
                  : { kind: 'error', runId: myRun, at: now, reason: 'per_code_error' },
                { updatedAt: now },
              );
            }
          } catch {
            // 單批失敗只影響該批代號；其他批的 payload 與狀態保留。
            if (myRun !== runIdRef.current) return;
            const now = Date.now();
            for (const code of chunk) {
              qc.setQueryData<ChipsBatchStatus>(
                chipsBatchStatusKey(code),
                { kind: 'error', runId: myRun, at: now, reason: 'chunk_failed' },
                { updatedAt: now },
              );
            }
          }
        }),
      );
      if (myRun !== runIdRef.current) return;
      setPrefetched(new Set(done));
    })();

    return () => {
      ac.abort();
    };
  }, [enabled, isDemo, key, qc, isViewAs]);

  const prefetch = useCallback(
    async (rawCode: string) => {
      const code = normalizeStockCode(rawCode);
      if (!isTaiwanStockCode(code)) return;

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
