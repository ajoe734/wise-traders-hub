import { useState, type ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface Props {
  /** 完整內容（顯示於 Tooltip） */
  full: string;
  /** 觸發區塊的內容（可為截斷後 UI） */
  children: ReactNode;
  className?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** 供 E2E 定位 */
  'data-testid'?: string;
}

/**
 * 代號+名稱 Tooltip：桌面 hover、行動裝置點擊皆可展開，
 * 顯示未截斷的完整字串，並保留鍵盤 focus 可用。
 */
export function InstrumentTooltip({ full, children, className, side = 'top', ...rest }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen} delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid={rest['data-testid']}
          className={cn(
            'inline text-left align-baseline cursor-help max-w-full',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-sm',
            className,
          )}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          aria-label={`完整名稱：${full}`}
          title={full /* 原生 tooltip fallback，供 no-JS / SR */}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        className="max-w-[280px] break-words [overflow-wrap:anywhere] text-sm"
        data-testid={rest['data-testid'] ? `${rest['data-testid']}-content` : undefined}
      >
        {full}
      </TooltipContent>
    </Tooltip>
  );
}
