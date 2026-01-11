import { SignalAction } from '@/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ActionBadgeProps {
  action: SignalAction;
  size?: 'sm' | 'default';
}

const actionConfig: Record<SignalAction, { label: string; className: string }> = {
  [SignalAction.BUY]: { 
    label: '買進', 
    className: 'bg-success text-white border-success' 
  },
  [SignalAction.SELL]: { 
    label: '賣出', 
    className: 'bg-destructive text-white border-destructive' 
  },
  [SignalAction.ADD]: { 
    label: '加碼', 
    className: 'bg-blue-500 text-blue-50 border-blue-500' 
  },
  [SignalAction.TRIM]: { 
    label: '減碼', 
    className: 'bg-amber-500 text-amber-50 border-amber-500' 
  },
  [SignalAction.EXIT]: { 
    label: '出場', 
    className: 'bg-slate-500 text-slate-50 border-slate-500' 
  },
};

export function ActionBadge({ action, size = 'default' }: ActionBadgeProps) {
  const config = actionConfig[action];
  
  return (
    <Badge 
      className={cn(
        config.className,
        size === 'sm' ? 'text-[10px] px-1.5 py-0' : 'text-xs px-2 py-0.5'
      )}
    >
      {config.label}
    </Badge>
  );
}
