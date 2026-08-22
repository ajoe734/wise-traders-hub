// @ts-nocheck
/**
 * Preview-only E2E harness.
 *   ?d=  — 既有模式：base64url JSON fixture → HoldingCardPriceTrack + HoldingCardFooter
 *   ?code= — Stage D 新增：渲染真實 HoldingCard（含 QueryClientProvider 與 useChipsBatch），
 *            讓「不開抽屜的 cache subscription」可被 e2e 驗證。兩種模式互不影響。
 *
 * SECURITY: gated to preview envs only; returns null in production.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const HoldingCard = lazy(() =>
  import('@/checkup/components/freecheckup/HoldingCard').then((m) => ({ default: m.default })),
);

/** ?code= 模式專用；harness 自帶 client，不依賴 App provider。 */
import { useChipsBatch } from '@/checkup/hooks/useChipsBatch';

const harnessQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

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

/**
 * useChipsBatch 只在「可見代號 key 變更」時發批次（keyRef 初始化為首次 key），
 * 因此 harness 必須從空清單起手再切到目標代號，才會真的跑一次批次。
 */
function ChipsBatchDriver({ codes }: { codes: string[] }) {
  const [active, setActive] = useState<string[]>([]);
  useEffect(() => {
    const t = setTimeout(() => setActive(codes), 0);
    return () => clearTimeout(t);
  }, [codes.join(',')]);
  useChipsBatch({ codes: active });
  return null;
}

function CardModeHarness({ code }: { code: string }) {
  const holding = {
    code,
    name: code,
    qty: 1000,
    cost: 100,
    price: 110,
    value: 110000,
  };
  return (
    <QueryClientProvider client={harnessQueryClient}>
        <div id="harness-root" style={{ padding: 24, background: '#fff', width: 480 }}>
          <Suspense fallback={<div>loading…</div>}>
            <ChipsBatchDriver codes={[code]} />
            <HoldingCard
              holding={holding}
              sparkData={null}
              sparkFailed={false}
              variant="normal"
              isFeatureSlot={false}
              isActive={false}
              onSelect={() => {}}
              onOpenDrawer={() => {}}
            />
          </Suspense>
        </div>
    </QueryClientProvider>
  );
}

export default function HoldingCardHarnessEntry() {
  // hooks 必須無條件在早退前呼叫（rules-of-hooks）
  const codeParam = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('code') || '';
    } catch {
      return '';
    }
  }, []);
  const result = useMemo(() => decodeFixture(), []);

  if (!isPreviewEnv()) return null;
  if (codeParam) return <CardModeHarness code={codeParam} />;

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
