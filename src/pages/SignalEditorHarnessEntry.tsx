// @ts-nocheck
/**
 * Preview-only E2E harness for the signal / journal editor's
 * stock-code → stock-name resolution + list / content display parity.
 *
 * Exercises the same code path as SignalCreateDialog:
 *   1. `spec.uppercaseSymbol` normalization of user input
 *   2. `resolveStockName(code)` lookup (may hit stock_names DB then edge fn)
 *   3. Concatenated `${code} ${name}` rendering that both the list card
 *      (`data-testid="editor-list-instrument"`) and the content preview
 *      (`data-testid="editor-content-instrument"`) share.
 *
 * SECURITY: gated to preview envs only; returns null in production.
 */
import { useEffect, useRef, useState } from 'react';
import { getAssetSpec, resolveAssetClass } from '@/lib/asset';
import { resolveStockName } from '@/lib/stockNameResolver';

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

export default function SignalEditorHarnessEntry() {
  if (!isPreviewEnv()) return null;

  const params = new URLSearchParams(window.location.search);
  const assetClass = resolveAssetClass({ asset_class: params.get('ac') || 'tw_stock' });
  const spec = getAssetSpec(assetClass);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [resolving, setResolving] = useState(false);
  const [autoUppercased, setAutoUppercased] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mirror SignalCreateDialog.handleStockCodeChange exactly.
  const onChange = (raw: string) => {
    const normalized = spec.uppercaseSymbol ? raw.toUpperCase() : raw;
    if (spec.uppercaseSymbol && raw !== normalized && /[a-z]/.test(raw)) {
      setAutoUppercased(true);
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setAutoUppercased(false), 3000);
    }
    setCode(normalized);
    setName('');
    if (timer.current) clearTimeout(timer.current);
    if (normalized.trim().length >= spec.minSymbolLen) {
      setResolving(true);
      timer.current = setTimeout(async () => {
        try {
          const n = await resolveStockName(normalized.trim());
          if (n) setName(n);
        } finally {
          setResolving(false);
        }
      }, 200);
    } else {
      setResolving(false);
    }
  };

  const instrument = name ? `${code.trim()} ${name}` : code.trim();

  return (
    <div
      id="editor-harness-root"
      style={{ padding: 24, background: '#fff', color: '#1a1a1a', width: 520, fontFamily: 'system-ui' }}
    >
      <label htmlFor="editor-code-input" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
        股票代碼（{spec.symbolPlaceholder}）
      </label>
      <input
        id="editor-code-input"
        data-testid="editor-code-input"
        value={code}
        onChange={(e) => onChange(e.target.value)}
        placeholder={spec.symbolPlaceholder}
        style={{ width: '100%', padding: 8, fontSize: 16, border: '1px solid #ccc', borderRadius: 4 }}
      />
      {autoUppercased && (
        <p
          data-testid="uppercase-hint"
          aria-live="polite"
          style={{ marginTop: 4, fontSize: 11, color: '#666' }}
        >
          已自動轉大寫
        </p>
      )}

      <div style={{ marginTop: 8, fontSize: 12 }} data-testid="editor-resolving">
        {resolving ? 'resolving…' : 'idle'}
      </div>

      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12, color: '#666' }}>List area (published preview row)</div>
        <div
          data-testid="editor-list-instrument"
          style={{ padding: 8, background: '#f5f3ef', borderRadius: 4, fontWeight: 500 }}
        >
          {instrument || <span data-testid="editor-list-empty">—</span>}
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12, color: '#666' }}>Content area (editor preview card)</div>
        <div
          data-testid="editor-content-instrument"
          style={{ padding: 8, background: '#eef', borderRadius: 4, fontWeight: 500 }}
        >
          <span data-testid="editor-content-code">{code.trim()}</span>
          {name && (
            <>
              {' '}
              <span data-testid="editor-content-name">{name}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
