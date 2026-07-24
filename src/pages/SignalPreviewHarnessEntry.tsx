// @ts-nocheck
/**
 * Preview-only harness for mobile visual regression on:
 *   1. <PreviewTradeItem>  (訊號編輯器內的交易列)
 *   2. Advisor preview row inside <SignalCreateDialog>
 *      — replicated 1:1 with same classNames so CSS truncation / overlap /
 *        overflow behavior can be asserted without mounting the full dialog.
 *
 * Query params: ?code=00631L&name=元大台灣50正2&price=123.45&qty=1&unit=張
 * Route: /e2e/signal-preview-harness
 */
import { Badge } from '@/components/ui/badge';
import { InstrumentTooltip } from '@/components/InstrumentTooltip';
import { PreviewTradeItem } from '@/pages/_adminSignals/PreviewTradeItem';
import { getActionMeta } from '@/lib/signalAction';

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

export default function SignalPreviewHarnessEntry() {
  if (!isPreviewEnv()) return null;
  const params = new URLSearchParams(window.location.search);
  const stockCode = params.get('code') || '00631L';
  const stockName = params.get('name') || '元大台灣50正2';
  const priceHint = params.get('price') || '123.45';
  const quantity = params.get('qty') || '1';
  const quantityUnit = params.get('unit') || '張';
  const currencySymbol = params.get('cur') || '$';
  const action = params.get('action') || 'buy';
  const instrument = `${stockCode} ${stockName}`;

  return (
    <div id="signal-preview-harness-root" className="bg-background text-foreground min-h-screen">
      {/* SECTION 1: PreviewTradeItem — actual component */}
      <section data-testid="section-preview-trade-item" className="border-b">
        <div className="px-2 py-1 text-[10px] text-muted-foreground bg-muted/40">PreviewTradeItem</div>
        <PreviewTradeItem
          action={action}
          instrument={instrument}
          priceHint={Number(priceHint)}
          reasonSummary=""
          reasonDetail=""
          riskNotes=""
        />
      </section>

      {/* SECTION 2: Advisor preview row — replicated markup from SignalCreateDialog */}
      <section data-testid="section-advisor-preview" className="border-b">
        <div className="px-2 py-1 text-[10px] text-muted-foreground bg-muted/40">Advisor preview row</div>
        <div className="bg-muted/50 p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">📋 訂閱者預覽</p>
          <div
            data-testid="advisor-preview-flex"
            className="flex items-start gap-2 flex-wrap"
          >
            <Badge variant="secondary" className="text-xs shrink-0">
              {getActionMeta(action).label}
            </Badge>
            <InstrumentTooltip
              full={stockName ? `${stockCode} ${stockName}` : stockCode}
              data-testid="advisor-preview-instrument"
              className="font-medium text-[13px] sm:text-sm min-w-0 break-words [overflow-wrap:anywhere] tracking-normal"
            >
              <span data-testid="adv-code" className="font-mono tabular-nums tracking-normal">
                {stockCode}
              </span>
              {stockName && (
                <>
                  {' '}
                  <span data-testid="adv-name" className="tracking-tight">
                    {stockName}
                  </span>
                </>
              )}
            </InstrumentTooltip>
            {priceHint && (
              <span
                data-testid="adv-price"
                className="font-mono tabular-nums text-[13px] sm:text-sm text-muted-foreground shrink-0 whitespace-nowrap tracking-normal"
              >
                @ {currencySymbol}
                {priceHint}
              </span>
            )}
            {quantity && (
              <span
                data-testid="adv-qty"
                className="font-mono tabular-nums text-[13px] sm:text-sm text-muted-foreground shrink-0 whitespace-nowrap tracking-normal"
              >
                {quantity} <span className="font-sans">{quantityUnit}</span>
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
