// @ts-nocheck
/**
 * Preview-only E2E harness for RangeBand (§4.6 30D 走勢帶).
 * Reads a base64url-encoded JSON fixture from ?d= and renders RangeBand
 * in isolation so Playwright can drive divergent price / spark scenarios
 * and verify the amber warning dot + data-inconsistent attributes.
 *
 * Fixture shape:
 *   { price?: number, low?: number, high?: number, spark?: number[],
 *     ohlc?: { open, high, low, close, date? }[], symbol?: string,
 *     priceSource?: string, priceUpdatedAt?: string }

 *
 * SECURITY: gated to preview envs only; returns null in production.
 */
import { Suspense, lazy, useMemo } from 'react';

const RangeBandLazy = lazy(() =>
  import('@/checkup/components/freecheckup/HoldingsDetailPanel').then((m) => ({
    default: m.RangeBand,
  })),
);

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

function decodeFixture(): { ok: true; fx: any } | { ok: false; err: string } {
  try {
    const params = new URLSearchParams(window.location.search);
    const d = params.get('d');
    if (!d) return { ok: false, err: 'missing d param' };
    const b64 = d.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const json = atob(b64 + pad);
    const fx = JSON.parse(decodeURIComponent(escape(json)));
    return { ok: true, fx };
  } catch (e: any) {
    return { ok: false, err: String(e?.message || e) };
  }
}

// Minimal WB tokens required by RangeBand.
const WB = {
  ink: '#292520',
  inkSub: '#5c554d',
  inkMute: '#8a857f',
  inkLight: '#c6c1ba',
  accent: '#EC662D',
  surface: '#F5F3EF',
  hair: '#e6e2dc',
  klineUp: '#D93025',
  klineDown: '#1E8E3E',
};


export default function RangeBandHarnessEntry() {
  if (!isPreviewEnv()) return null;

  const result = useMemo(() => decodeFixture(), []);
  if (!result.ok) {
    return (
      <div id="harness-root" style={{ padding: 24, fontFamily: 'monospace' }}>
        <pre data-testid="harness-error">ERR: {result.err}</pre>
      </div>
    );
  }

  const fx = result.fx || {};

  return (
    <div
      id="harness-root"
      style={{
        padding: 24,
        background: WB.surface,
        color: WB.ink,
        width: 480,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <Suspense fallback={<div>loading…</div>}>
        <RangeBandLazy
          WB={WB}
          price={fx.price}
          low={fx.low}
          high={fx.high}
          spark={fx.spark}
          ohlc={fx.ohlc}
          symbol={fx.symbol}
          priceSource={fx.priceSource}
          priceUpdatedAt={fx.priceUpdatedAt}
        />

      </Suspense>
    </div>
  );
}
