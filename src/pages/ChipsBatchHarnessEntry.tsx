// @ts-nocheck
/**
 * Preview-only E2E harness · chips 批次
 *
 * URL: /e2e/chips-batch?codes=2330,2317
 *   - 預設（既有行為）：直接調用 `fetchChipsBatch` 並渲染結果計數。
 *   - Stage D：改走真實 `useChipsBatch` hook，讓 31+ 檔的分塊、per-chunk 狀態與
 *     runId race 防護都是「產品那一套」，不是 harness 另刻的第二套 orchestration。
 *     既有 data-testid 契約（batch-status / batch-returned / batch-failed …）全部保留。
 *
 * SECURITY: preview-only；prod 回傳 null。
 */
import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useChipsBatch, chipsBatchStatusKey } from '@/checkup/hooks/useChipsBatch';
import { chipsQueryKey } from '@/checkup/hooks/useTwChipsDetail';

const harnessQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function isPreviewEnv() {
  try {
    const h = typeof window !== 'undefined' ? window.location.hostname : '';
    return (
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ||
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h.endsWith('.lovableproject.com') ||
      (h.startsWith('id-preview--') && h.endsWith('.lovable.app'))
    );
  } catch {
    return false;
  }
}

function BatchHarnessBody({ codes }: { codes: string[] }) {
  const qc = useQueryClient();
  const [active, setActive] = useState<string[]>([]);
  const [tick, setTick] = useState(0);

  // keyRef 初始化為首次 key → 必須從空清單切到目標代號才會觸發批次
  useEffect(() => {
    const t = setTimeout(() => setActive(codes), 0);
    return () => clearTimeout(t);
  }, [codes.join(',')]);

  useChipsBatch({ codes: active });

  // 輪詢快取，把 hook 寫入的狀態攤成 DOM 契約（harness 自己不打任何 API）
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 150);
    return () => clearInterval(id);
  }, []);

  const view = useMemo(() => {
    const statuses = codes.map((c) => ({
      code: c,
      status: qc.getQueryData(chipsBatchStatusKey(c)) as any,
      payload: (qc.getQueryData(chipsQueryKey(c)) as any)?.payload ?? null,
    }));
    const settled = statuses.filter((s) => s.status && s.status.kind !== 'pending');
    const returned = statuses.filter((s) => s.payload).map((s) => s.code);
    const failed = statuses.filter((s) => s.status?.kind === 'error').length;
    const notApplicable = statuses.filter((s) => s.status?.kind === 'not_applicable').length;
    const status =
      active.length === 0 ? 'loading' : settled.length === codes.length ? 'ready' : 'loading';
    return { statuses, returned, failed, notApplicable, status };
  }, [codes, qc, tick, active.length]);

  const first = view.returned[0]
    ? (qc.getQueryData(chipsQueryKey(view.returned[0])) as any)?.payload
    : null;
  const hasBsr = first && Object.keys(first?.bsr || {}).length > 0;
  const hasInst =
    first && Object.values(first?.institutional || {}).some((v) => v !== null && v !== undefined);

  return (
    <div className="p-6 font-sans" data-testid="chips-batch-harness">
      <h1 className="text-lg font-semibold mb-4">Chips Batch Harness</h1>
      <div data-testid="batch-status" data-status={view.status}>
        {view.status === 'loading' ? '載入中...' : '批次完成'}
      </div>
      <div data-testid="batch-result" className="mt-4 space-y-1">
        <div data-testid="batch-codes">{codes.join(',')}</div>
        <div data-testid="batch-returned" data-count={view.returned.length}>
          returned: {view.returned.length}
        </div>
        <div data-testid="batch-failed" data-count={view.failed}>
          failed: {view.failed}
        </div>
        <div data-testid="batch-not-applicable" data-count={view.notApplicable}>
          not_applicable: {view.notApplicable}
        </div>
        <div data-testid="batch-first-code">{view.returned[0] || 'none'}</div>
        <div data-testid="batch-has-bsr" data-value={hasBsr ? 'true' : 'false'}>
          has_bsr: {hasBsr ? 'true' : 'false'}
        </div>
        <div data-testid="batch-has-inst" data-value={hasInst ? 'true' : 'false'}>
          has_inst: {hasInst ? 'true' : 'false'}
        </div>
      </div>
      <ul className="mt-4">
        {view.statuses.map((s) => (
          <li
            key={s.code}
            data-testid={`batch-code-${s.code}`}
            data-kind={s.status?.kind || 'none'}
            data-reason={s.status?.reason || ''}
          >
            {s.code}: {s.status?.kind || 'none'}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ChipsBatchHarnessEntry() {
  if (!isPreviewEnv()) return null;

  const codes = useMemo(() => {
    const params = new URLSearchParams(
      typeof window !== 'undefined' ? window.location.search : '',
    );
    return (params.get('codes') || '2330,2317')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
  }, []);

  return (
    <QueryClientProvider client={harnessQueryClient}>
      <BatchHarnessBody codes={codes} />
    </QueryClientProvider>
  );
}
