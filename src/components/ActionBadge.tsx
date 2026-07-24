import { SignalAction } from '@/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getActionMeta } from '@/lib/signalAction';

type ExtendedAction = SignalAction | 'teaching' | 'hold';

interface ActionBadgeProps {
  action: ExtendedAction | string | null | undefined;
  size?: 'sm' | 'default';
}

export function ActionBadge({ action, size = 'default' }: ActionBadgeProps) {
  const meta = getActionMeta(action ?? undefined);
  return (
    <Badge
      className={cn(
        meta.className,
        size === 'sm' ? 'text-[10px] px-1.5 py-0' : 'text-xs px-2 py-0.5'
      )}
    >
      {meta.label}
    </Badge>
  );
}
