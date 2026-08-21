import { cn } from '@/lib/utils';

export interface WeekTimelineItemProps {
  /** 步驟標題（結構名稱，非任何老師的實際內容）。 */
  title: string;
  desc?: string | null;
  /** 是否為最後一項（不畫下方連接線）。 */
  last?: boolean;
  className?: string;
}

/**
 * 每週交付節奏的時間軸項目（細線、無陰影）。
 * 只描述結構，不描述任何老師的實際內容、標的或成果。
 */
export function WeekTimelineItem({ title, desc, last, className }: WeekTimelineItemProps) {
  return (
    <div className={cn('evidence-surface', className)} style={{ background: 'transparent' }}>
      <div className="flex gap-3">
        <div className="flex flex-col items-center pt-1.5">
          <span
            aria-hidden="true"
            className="block h-1.5 w-1.5 rounded-full"
            style={{ background: 'var(--ev-text-mute)' }}
          />
          {!last && (
            <span
              aria-hidden="true"
              className="mt-1 w-px flex-1"
              style={{ background: 'var(--ev-line-soft)', minHeight: 20 }}
            />
          )}
        </div>
        <div className={cn('pb-3', last && 'pb-0')}>
          <div className="ev-title" style={{ fontSize: 14 }}>{title}</div>
          {desc ? <p className="ev-body mt-1">{desc}</p> : null}
        </div>
      </div>
    </div>
  );
}
