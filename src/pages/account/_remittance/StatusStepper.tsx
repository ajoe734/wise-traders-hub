import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Status = 'awaiting_info' | 'pending' | 'confirmed' | 'rejected' | string;

const STEPS = [
  { key: 'created', label: '建立訂單' },
  { key: 'awaiting_info', label: '待補匯款資料' },
  { key: 'pending', label: '待對帳' },
  { key: 'confirmed', label: '已開通' },
] as const;

const ORDER: Record<string, number> = {
  created: 0,
  awaiting_info: 1,
  pending: 2,
  confirmed: 3,
};

export function RemittanceStatusStepper({ status }: { status: Status }) {
  const isRejected = status === 'rejected';
  const currentIdx = isRejected ? 1 : (ORDER[status] ?? 0);

  return (
    <div className="flex items-center w-full" role="list" aria-label="匯款訂單進度">
      {STEPS.map((step, i) => {
        const isLast = i === STEPS.length - 1;
        const reached = i <= currentIdx;
        const isCurrent = i === currentIdx;
        const showReject = isRejected && isLast;

        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none" role="listitem">
            <div className="flex flex-col items-center gap-1.5 min-w-0">
              <div
                className={cn(
                  'h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-medium border transition-colors',
                  showReject
                    ? 'bg-destructive border-destructive text-destructive-foreground'
                    : reached
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'bg-background border-border text-muted-foreground',
                  isCurrent && !showReject && 'ring-2 ring-primary/30',
                )}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {showReject ? <X className="h-3 w-3" /> : reached ? <Check className="h-3 w-3" /> : i + 1}
              </div>
              <span
                className={cn(
                  'text-[10px] whitespace-nowrap',
                  showReject ? 'text-destructive font-medium'
                    : isCurrent ? 'text-foreground font-medium'
                    : reached ? 'text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {showReject ? '已拒絕' : step.label}
              </span>
            </div>
            {!isLast && (
              <div
                className={cn(
                  'h-px flex-1 mx-2 mb-5 transition-colors',
                  i < currentIdx && !isRejected ? 'bg-primary' : 'bg-border',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
