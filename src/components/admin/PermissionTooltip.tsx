import * as React from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface PermissionTooltipProps {
  disabled: boolean;
  children: React.ReactNode;
  message?: string;
}

/**
 * 將需要權限的按鈕包起來：
 * - disabled=true 時，hover 顯示「僅限方案擁有者或公司管理員操作」
 * - disabled=false 時，直接渲染 children 不影響原行為
 *
 * 注意：children 必須能接收 disabled prop（如 Button、Switch）。
 * 用 span wrapper 才能在 disabled 元素上觸發 hover。
 */
export const PermissionTooltip: React.FC<PermissionTooltipProps> = ({
  disabled,
  children,
  message = '僅限方案擁有者或公司管理員操作',
}) => {
  if (!disabled) return <>{children}</>;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-block cursor-not-allowed">{children}</span>
        </TooltipTrigger>
        <TooltipContent side="top">{message}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
