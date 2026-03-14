import { SignalAction } from '@/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ActionBadgeProps {
  action: SignalAction;
  size?: 'sm' | 'default';
}

const actionConfig: Record<SignalAction, { label: string; className: string }> = {
  buy: { label: '買進', className: 'bg-destructive text-white border-destructive' },
  sell: { label: '賣出', className: 'bg-success text-white border-success' },
  add: { label: '加碼', className: 'bg-destructive text-white border-destructive' },
  trim: { label: '減碼', className: 'bg-success text-white border-success' },
  exit: { label: '平損', className: 'bg-muted text-muted-foreground border-border' },
};

export function ActionBadge({ action, size = 'default' }: ActionBadgeProps) {
  const config = actionConfig[action];
  
  return (
    <Badge 
      className={cn(
        config?.className,
        size === 'sm' ? 'text-[10px] px-1.5 py-0' : 'text-xs px-2 py-0.5'
      )}
    >
      {config?.label ?? action}
    </Badge>
  );
}
