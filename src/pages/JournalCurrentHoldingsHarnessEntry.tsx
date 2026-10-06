import { CurrentHoldingsGridView } from '@/pages/app/_journalDetail/CurrentHoldingsGrid';
import { resolveProjectionStatus } from '@/contracts/publicProjection';
import type { PerfRow } from '@/pages/_adminPerformance/types';

export const JOURNAL_HOLDINGS_HARNESS_MARKER = 'JOURNAL_CURRENT_HOLDINGS_V1';

const ready = resolveProjectionStatus({ state: 'ready' });

const positions: PerfRow[] = [
  { id: '2492', symbol: '2492', name: '華新科', instrument: '2492 華新科', quantity: 300, quantity_unit: '股', base_quantity: 300, entry_price: 377.5, current_price: 368.5, pnl: -2700, pnl_percent: -2.38, status: 'open', currency: 'TWD', asset_class: 'tw_stock' },
  { id: '5498', symbol: '5498', name: '凱崴', instrument: '5498 凱崴', quantity: 5000, quantity_unit: '張', base_quantity: 5000000, entry_price: 52.5, current_price: 54.8, pnl: 11500000, pnl_percent: 4.38, status: 'open', currency: 'TWD', asset_class: 'tw_stock' },
  { id: '00708L', symbol: '00708L', name: '期元大S&P黃金正2', instrument: '00708L 期元大S&P黃金正2', quantity: 5000, quantity_unit: '張', base_quantity: 5000000, entry_price: 73.47, current_price: null, pnl: null, pnl_percent: null, status: 'open', currency: 'TWD', asset_class: 'tw_stock' },
  { id: '8358', symbol: '8358', name: '金居', instrument: '8358 金居', quantity: 1000, quantity_unit: '股', base_quantity: 1000, entry_price: 504.1, current_price: 570, pnl: 65900, pnl_percent: 13.07, status: 'open', currency: 'TWD', asset_class: 'tw_stock' },
  { id: '2344', symbol: '2344', name: '華邦電', instrument: '2344 華邦電', quantity: 1000, quantity_unit: '張', base_quantity: 1000000, entry_price: 173, current_price: 181, pnl: 8000000, pnl_percent: 4.62, status: 'open', currency: 'TWD', asset_class: 'tw_stock' },
  { id: '2316', symbol: '2316', name: '楠梓電', instrument: '2316 楠梓電', quantity: 1000, quantity_unit: '張', base_quantity: 1000000, entry_price: 162, current_price: 171.5, pnl: 9500000, pnl_percent: 5.86, status: 'open', currency: 'TWD', asset_class: 'tw_stock' },
];

export default function JournalCurrentHoldingsHarnessEntry() {
  const state = new URLSearchParams(window.location.search).get('state') || 'ready';
  const common = { currency: 'TWD' as const, assetClass: 'tw_stock' as const, projection: ready };

  return (
    <main className="min-h-screen bg-background p-4 text-foreground">
      <p data-testid="journal-holdings-harness-marker" className="sr-only">{JOURNAL_HOLDINGS_HARNESS_MARKER}</p>
      <div className="mx-auto max-w-6xl">
        <header className="mb-4 border-b border-border pb-4">
          <p className="text-xs text-muted-foreground">彥愷 · 實戰導師</p>
          <p className="mt-1 text-sm text-foreground">09/28–10/04 週記</p>
        </header>
        {state === 'loading' ? <CurrentHoldingsGridView {...common} positions={[]} loading /> : null}
        {state === 'error' ? <CurrentHoldingsGridView {...common} positions={[]} error onRetry={() => undefined} /> : null}
        {state === 'empty' ? <CurrentHoldingsGridView {...common} positions={[]} /> : null}
        {state === 'review' ? <CurrentHoldingsGridView {...common} positions={positions} projection={resolveProjectionStatus({ manualReview: true })} /> : null}
        {state === 'ready' ? <CurrentHoldingsGridView {...common} positions={positions} updatedAt={Date.now()} /> : null}
        <div className="mt-5 border-t border-border pt-4">
          <h1 className="text-xl font-bold">本週操作回顧</h1>
        </div>
      </div>
    </main>
  );
}