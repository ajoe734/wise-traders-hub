// @ts-nocheck
/**
 * Preview-only E2E harness · fetchChipsBatch
 *
 * URL: /e2e/chips-batch?codes=2330,2317
 *   - codes: 逗號分隔的台股代碼，會被批次送到 POST /tw-chips-detail
 *   - 頁面直接調用 fetchChipsBatch 並渲染結果計數，供 E2E 驗證統一端點的整合。
 *
 * SECURITY: preview-only；prod 回傳 null。
 */
import { useEffect, useState } from 'react';
import { fetchChipsBatch } from '@/checkup/lib/chipsRepository';

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

export default function ChipsBatchHarnessEntry() {
  if (!isPreviewEnv()) return null;

  const params = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.search : '',
  );
  const codes = (params.get('codes') || '2330,2317')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  const [status, setStatus] = useState('loading');
  const [result, setResult] = useState(null);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchChipsBatch(codes, { telemetry: { source: 'e2e_batch_harness' } })
      .then((res) => {
        if (cancelled) return;
        setResult(res);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorText(err?.message || String(err));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [codes.join(',')]);

  const keys = result ? Object.keys(result.results) : [];
  const first = keys[0] ? result.results[keys[0]] : null;
  const hasBsr = first && Object.keys(first?.bsr || {}).length > 0;
  const hasInst =
    first &&
    Object.values(first?.institutional || {}).some(
      (v) => v !== null && v !== undefined,
    );

  return (
    <div className="p-6 font-sans" data-testid="chips-batch-harness">
      <h1 className="text-lg font-semibold mb-4">Chips Batch Harness</h1>
      <div data-testid="batch-status" data-status={status}>
        {status === 'loading' && '載入中...'}
        {status === 'error' && '批次失敗'}
        {status === 'ready' && '批次完成'}
      </div>
      {status === 'error' && (
        <div data-testid="batch-error" className="text-red-600 mt-2">
          {errorText}
        </div>
      )}
      {status === 'ready' && result && (
        <div data-testid="batch-result" className="mt-4 space-y-1">
          <div data-testid="batch-codes">{codes.join(',')}</div>
          <div data-testid="batch-returned" data-count={keys.length}>
            returned: {keys.length}
          </div>
          <div data-testid="batch-failed" data-count={result.failed}>
            failed: {result.failed}
          </div>
          <div data-testid="batch-first-code">{keys[0] || 'none'}</div>
          <div data-testid="batch-has-bsr" data-value={hasBsr ? 'true' : 'false'}>
            has_bsr: {hasBsr ? 'true' : 'false'}
          </div>
          <div data-testid="batch-has-inst" data-value={hasInst ? 'true' : 'false'}>
            has_inst: {hasInst ? 'true' : 'false'}
          </div>
          <div data-testid="batch-served-at">{result.servedAt}</div>
        </div>
      )}
    </div>
  );
}
