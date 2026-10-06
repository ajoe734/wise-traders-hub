import { useState } from 'react';
import { Activity, ChevronDown, ChevronUp, CircleAlert, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePositionEvents, type PositionEvent } from '@/hooks/usePositionEvents';
import { CURRENCY_SYMBOL, formatPriceByCurrency } from '@/lib/currency';
import { resolvePositionQuantityDisplay } from '@/lib/positionQuantity';
import { getActionMeta } from '@/lib/signalAction';

const PREVIEW_COUNT = 6;
const getPositionEventActionLabel = (action: PositionEvent['action']) => {
  if (action === 'correction') return '訂正';
  if (action === 'exit') return '全部賣出';
  return getActionMeta(action).label;
};

function quantityLabel(event: PositionEvent, value: number) {
  return resolvePositionQuantityDisplay(Math.abs(value), event.quantity_unit, event.asset_class).label;
}

export function PositionTimelineView({ events, loading, error, onRetry }: {
  events: PositionEvent[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? events : events.slice(0, PREVIEW_COUNT);
  return (
    <section data-testid="journal-position-timeline" aria-labelledby="journal-position-timeline-title" className="border-t border-border pt-4">
      <div className="mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-mentor" aria-hidden="true" />
        <h2 id="journal-position-timeline-title" className="text-base font-bold text-foreground">持股變化</h2>
      </div>
      {loading ? <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : null}
      {!loading && error ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 p-3">
          <span className="flex items-center gap-2 text-sm"><CircleAlert className="h-4 w-4 text-destructive" />持股變化讀取失敗</span>
          {onRetry ? <Button size="sm" variant="outline" onClick={onRetry}><RefreshCw className="mr-1 h-3.5 w-3.5" />重試</Button> : null}
        </div>
      ) : null}
      {!loading && !error && events.length === 0 ? <p className="rounded-md border border-border bg-muted/20 p-4 text-sm text-muted-foreground">尚無持股變化紀錄。</p> : null}
      {!loading && !error && events.length > 0 ? (
        <>
          <ol className="space-y-0 border-l border-border ml-2">
            {visible.map((event) => {
              const positive = event.quantity_delta > 0;
              const date = new Date(event.event_at);
              return (
                <li key={event.id} className="relative pb-4 pl-5 last:pb-0">
                  <span className="absolute -left-1 top-1.5 h-2 w-2 rounded-full bg-mentor" aria-hidden="true" />
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0">
                      <strong className="text-sm text-foreground">{event.symbol} {event.instrument.replace(event.symbol, '').trim()}</strong>
                      <span className="ml-2 text-xs font-medium text-mentor">{getPositionEventActionLabel(event.action)}</span>
                    </div>
                    <time className="text-xs tabular-nums text-muted-foreground" dateTime={event.event_at}>{date.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '/')}</time>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    <span className="font-mono tabular-nums text-foreground">{positive ? '+' : '−'}{quantityLabel(event, event.quantity_delta)}</span>
                    <span className="mx-2">·</span>
                    {event.trade_price == null ? '成交價未提供' : `${CURRENCY_SYMBOL[event.currency]}${formatPriceByCurrency(event.trade_price, event.currency)}`}
                    <span className="mx-2">·</span>持有 {quantityLabel(event, event.quantity_after)}
                  </p>
                  {event.source_kind === 'reconstructed' ? <p className="mt-1 text-xs text-muted-foreground">依既有已發布訊號重建</p> : null}
                </li>
              );
            })}
          </ol>
          {events.length > PREVIEW_COUNT ? (
            <Button type="button" variant="ghost" size="sm" className="mt-3 gap-1.5 text-mentor hover:text-mentor" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
              {expanded ? <ChevronUp /> : <ChevronDown />}{expanded ? '收合紀錄' : `查看全部 ${events.length} 筆`}
            </Button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function PositionTimeline({ expertId, showNumbers }: { expertId: string; showNumbers: boolean }) {
  const query = usePositionEvents(showNumbers ? expertId : undefined);
  if (!showNumbers) return null;
  return <PositionTimelineView events={query.data ?? []} loading={query.isLoading} error={query.isError} onRetry={() => { void query.refetch(); }} />;
}