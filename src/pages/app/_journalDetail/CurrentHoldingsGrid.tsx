import { useState } from 'react';
import { ChevronDown, ChevronUp, CircleAlert, RefreshCw, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useExpertHoldingsBundle } from '@/hooks/useExpertHoldingsBundle';
import { getAssetSpec, type AssetClass } from '@/lib/asset';
import {
  CURRENCY_SYMBOL,
  formatMoneyByCurrency,
  formatPriceByCurrency,
  normalizeCurrency,
  type Currency,
} from '@/lib/currency';
import { useFreshness } from '@/checkup/lib/freshness';
import { UNAVAILABLE_LABEL, type ProjectionStatus } from '@/contracts/publicProjection';
import type { PerfRow } from '@/pages/_adminPerformance/types';
import { cn } from '@/lib/utils';
import { PositionTimeline } from './PositionTimeline';

const PREVIEW_COUNT = 3;

export interface CurrentHoldingsGridViewProps {
  positions: PerfRow[];
  currency: Currency;
  assetClass: AssetClass;
  projection: ProjectionStatus;
  loading?: boolean;
  error?: boolean;
  refreshing?: boolean;
  updatedAt?: number | null;
  onRetry?: () => void;
}

function formatQuantity(value: number, unit: string) {
  const formatted = Number.isInteger(value)
    ? value.toLocaleString('zh-TW')
    : value.toLocaleString('zh-TW', { maximumFractionDigits: 4 });
  return `${formatted} ${unit}`;
}

function directionClass(value: number | null) {
  if (value != null && value > 0) return 'text-success';
  if (value != null && value < 0) return 'text-destructive';
  return 'text-foreground';
}

function formatSignedPercent(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function PositionCard({ position }: { position: PerfRow }) {
  const currency = normalizeCurrency(position.currency);
  const assetClass = position.asset_class ?? 'tw_stock';
  const priceDigits = getAssetSpec(assetClass).priceDigits;
  const quoteMissing = position.current_price == null || position.pnl == null || position.pnl_percent == null;
  const masked = position.under_review === true;
  const unavailable = masked ? UNAVAILABLE_LABEL : '報價更新中';

  return (
    <article
      data-testid="journal-holding-card"
      className="min-w-0 rounded-md border border-border bg-card p-4 transition-colors duration-200 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1"
    >
      <div className="flex min-w-0 items-start justify-between gap-3 border-b border-border/70 pb-3">
        <div className="min-w-0">
          <p className="font-mono text-xs tabular-nums text-muted-foreground">{position.symbol}</p>
          <h3 className="mt-1 break-words text-base font-bold leading-tight text-foreground">
            {position.name || position.instrument || position.symbol}
          </h3>
        </div>
        <span className="shrink-0 rounded-sm border border-border bg-muted/40 px-2 py-1 text-xs tabular-nums text-muted-foreground">
          {masked ? UNAVAILABLE_LABEL : formatQuantity(position.quantity, position.quantity_unit)}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">平均成本</dt>
          <dd className="mt-1 truncate font-mono tabular-nums text-foreground">
            {masked || position.entry_price == null
              ? unavailable
              : `${CURRENCY_SYMBOL[currency]}${formatPriceByCurrency(position.entry_price, currency, priceDigits)}`}
          </dd>
        </div>
        <div className="min-w-0 text-right">
          <dt className="text-xs text-muted-foreground">目前現價</dt>
          <dd className="mt-1 truncate font-mono tabular-nums text-foreground">
            {masked || quoteMissing
              ? unavailable
              : `${CURRENCY_SYMBOL[currency]}${formatPriceByCurrency(position.current_price, currency, priceDigits)}`}
          </dd>
        </div>
        <div className="col-span-2 flex min-w-0 items-end justify-between gap-3 border-t border-border/70 pt-3">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">未實現損益</dt>
            <dd className={cn('mt-1 break-words font-mono text-sm font-medium tabular-nums', directionClass(position.pnl))}>
              {masked || quoteMissing
                ? unavailable
                : `${position.pnl != null && position.pnl > 0 ? '+' : ''}${formatMoneyByCurrency(position.pnl, currency)}`}
            </dd>
          </div>
          <div className="shrink-0 text-right">
            <dt className="sr-only">未實現報酬率</dt>
            <dd className={cn('font-mono text-lg font-bold tabular-nums', directionClass(position.pnl_percent))}>
              {masked || quoteMissing ? '—' : formatSignedPercent(position.pnl_percent)}
            </dd>
          </div>
        </div>
      </dl>
    </article>
  );
}

function LoadingGrid() {
  return (
    <div data-testid="journal-holdings-loading" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="h-44 rounded-md border border-border bg-card p-4">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-2 h-5 w-28" />
          <div className="mt-7 grid grid-cols-2 gap-4">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
          <Skeleton className="mt-5 h-8" />
        </div>
      ))}
    </div>
  );
}

export function CurrentHoldingsGridView({
  positions,
  currency,
  assetClass,
  projection,
  loading = false,
  error = false,
  refreshing = false,
  updatedAt = null,
  onRetry,
}: CurrentHoldingsGridViewProps) {
  const [expanded, setExpanded] = useState(false);
  const freshness = useFreshness(updatedAt);
  const visiblePositions = expanded ? positions : positions.slice(0, PREVIEW_COUNT);
  const hasMore = positions.length > PREVIEW_COUNT;
  const marketLabel = getAssetSpec(assetClass).shortLabel;

  return (
    <section data-testid="journal-current-holdings" aria-labelledby="journal-current-holdings-title" className="py-1">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <WalletCards className="h-4 w-4 text-mentor" aria-hidden="true" />
            <h2 id="journal-current-holdings-title" className="text-base font-bold text-foreground">目前持股</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {marketLabel} · {currency} · {positions.length} 檔
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {updatedAt ? (
            <time dateTime={new Date(updatedAt).toISOString()} title={freshness.clock}>{freshness.label}</time>
          ) : null}
          {refreshing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-label="持股更新中" /> : null}
        </div>
      </div>

      {loading ? <LoadingGrid /> : null}

      {!loading && error ? (
        <div data-testid="journal-holdings-error" role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <div className="flex min-w-0 items-start gap-2">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <div>
              <p className="text-sm font-bold text-foreground">目前持股讀取失敗</p>
              <p className="mt-0.5 text-xs text-muted-foreground">週記內容仍可正常閱讀。</p>
            </div>
          </div>
          {onRetry ? (
            <Button type="button" size="sm" variant="outline" onClick={onRetry} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              重新讀取
            </Button>
          ) : null}
        </div>
      ) : null}

      {!loading && !error && !projection.showNumbers ? (
        <div data-testid="journal-holdings-review" className="rounded-md border border-border bg-muted/30 p-4">
          <p className="text-sm font-bold text-foreground">{projection.badge || '資料檢核中'}</p>
          <p className="mt-1 text-xs text-muted-foreground">目前持股數量與損益暫不顯示，避免呈現未完成檢核的數字。</p>
        </div>
      ) : null}

      {!loading && !error && projection.showNumbers && positions.length === 0 ? (
        <div data-testid="journal-holdings-empty" className="rounded-md border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          這位老師目前沒有未平倉持股。
        </div>
      ) : null}

      {!loading && !error && projection.showNumbers && positions.length > 0 ? (
        <>
          <div id="journal-holdings-card-list" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visiblePositions.map((position) => <PositionCard key={position.id} position={position} />)}
          </div>
          {hasMore ? (
            <div className="mt-3 flex justify-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={expanded}
                aria-controls="journal-holdings-card-list"
                onClick={() => setExpanded((value) => !value)}
                className="gap-1.5 text-mentor hover:text-mentor"
                data-testid="journal-holdings-toggle"
              >
                {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                {expanded ? '收合持股' : `查看全部 ${positions.length} 檔`}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

interface CurrentHoldingsGridProps {
  expertId: string;
  currency?: Currency | string | null;
  assetClass?: AssetClass | string | null;
}

export function CurrentHoldingsGrid({ expertId, currency, assetClass }: CurrentHoldingsGridProps) {
  const bundle = useExpertHoldingsBundle(expertId, { currency, assetClass });

  return (
    <div className="space-y-4">
      <CurrentHoldingsGridView
        positions={bundle.openPositions}
        currency={bundle.currency}
        assetClass={bundle.assetClass}
        projection={bundle.projection}
        loading={bundle.loading}
        error={bundle.isError}
        refreshing={bundle.isFetching && !bundle.loading}
        updatedAt={bundle.dataUpdatedAt}
        onRetry={() => { void bundle.refetch(); }}
      />
      {!bundle.loading && !bundle.isError ? <PositionTimeline expertId={expertId} showNumbers={bundle.projection.showNumbers} /> : null}
    </div>
  );
}