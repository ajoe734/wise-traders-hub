import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { REVIEW_BADGE, REVIEW_NOTE, type ProjectionStatus } from '@/contracts/publicProjection';

/**
 * The single consumer-facing rendering of a not-ready projection scope.
 * Shows 「資料檢核中」/「該區間不納入績效」 and nothing else — no quantity,
 * no NAV, no return, no internal reason code, no manifest key.
 */
export function PerformanceReviewNotice({
  status,
  className,
  compact = false,
}: {
  status: ProjectionStatus;
  className?: string;
  compact?: boolean;
}) {
  if (!status.showReviewNotice) return null;
  return (
    <div
      data-testid="performance-review-notice"
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm',
        className,
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="space-y-0.5">
        <div className="font-medium text-foreground">{REVIEW_BADGE}</div>
        {!compact && <div className="text-xs text-muted-foreground">{REVIEW_NOTE}</div>}
      </div>
    </div>
  );
}

/** Inline replacement for a single number that must not be shown. */
export function ReviewPlaceholder({ className }: { className?: string }) {
  return (
    <span
      data-testid="review-placeholder"
      className={cn('text-sm font-medium text-muted-foreground', className)}
    >
      {REVIEW_BADGE}
    </span>
  );
}
