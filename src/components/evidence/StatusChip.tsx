import { cn } from '@/lib/utils';

export interface StatusChipProps {
  label: string;
  tone?: 'neutral' | 'active' | 'locked';
  className?: string;
}

/**
 * Evidence surface 內的細線狀態 chip（無陰影、無漸層）。
 * root 自帶 `evidence-surface`，可獨立放在深色 shell 裡。
 */
export function StatusChip({ label, tone = 'neutral', className }: StatusChipProps) {
  return (
    <span className={cn('evidence-surface inline-block', className)} style={{ background: 'transparent' }}>
      <span className="ev-chip" data-tone={tone}>
        <span className="ev-chip-dot" aria-hidden="true" />
        {label}
      </span>
    </span>
  );
}
