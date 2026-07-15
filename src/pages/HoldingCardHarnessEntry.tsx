// @ts-nocheck
/**
 * Preview-only E2E harness for HoldingCardPriceTrack + HoldingCardFooter.
 * Reads a base64url-encoded JSON fixture from ?d= and renders both components
 * with deterministic colors, so Playwright can drive edge/boundary scenarios.
 *
 * SECURITY: gated to preview envs only; returns null in production.
 */
import { Suspense, lazy, useMemo } from 'react';

const HoldingCardPriceTrack = lazy(() =>
  import('@/checkup/components/freecheckup/_ui/holdingCard/HoldingCardPriceTrack').then(
    (m) => ({ default: m.HoldingCardPriceTrack ?? m.default }),
  ),
);
const HoldingCardFooter = lazy(() =>
  import('@/checkup/components/freecheckup/_ui/holdingCard/HoldingCardFooter').then(
    (m) => ({ default: m.HoldingCardFooter ?? m.default }),
  ),
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

export default function HoldingCardHarnessEntry() {
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
  const variant = fx.variant === 'ink' ? 'ink' : 'normal';

  return (
    <div
      id="harness-root"
      style={{ padding: 24, background: '#fff', color: '#1a1a1a', width: 480 }}
    >
      <Suspense fallback={<div>loading…</div>}>
        <HoldingCardPriceTrack
          h={fx.h ?? {}}
          meta={fx.meta ?? null}
          dec={fx.dec ?? null}
          subColor="#1a1a1a"
          muteColor="#666666"
          variant={variant}
        />
        <HoldingCardFooter
          h={fx.h ?? {}}
          tp={fx.tp ?? null}
          upside={fx.upside ?? null}
          hasToday={!!fx.hasToday}
          todayPnlNum={fx.todayPnlNum ?? null}
          todayPctNum={fx.todayPctNum ?? null}
          variant={variant}
          subColor="#1a1a1a"
          muteColor="#666666"
          hairColor="#eeeeee"
          lossColor="#c0392b"
        />
      </Suspense>
    </div>
  );
}
