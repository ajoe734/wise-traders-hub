import { AlertCircle, RefreshCw, Settings2, ArrowRightLeft, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { MappedPublishError } from './publishErrorMapper';

interface Action {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  variant?: 'default' | 'outline' | 'secondary';
}

interface Props {
  error: MappedPublishError;
  /** 針對各錯誤碼的下一步 callbacks；未提供者不顯示對應按鈕 */
  onRetry?: () => void;
  onGoToProfile?: () => void;
  onUseLockedUnit?: () => void;
  onOpenRealign?: () => void;
  onUseAllowedUnit?: () => void;
  onDismiss?: () => void;
}

export function PublishErrorBanner({
  error,
  onRetry,
  onGoToProfile,
  onUseLockedUnit,
  onOpenRealign,
  onUseAllowedUnit,
  onDismiss,
}: Props) {
  const actions: Action[] = [];

  if (error.code === 'CAPITAL_EXCEEDED') {
    if (onGoToProfile) actions.push({
      label: '前往分析師設定', onClick: onGoToProfile, icon: <Settings2 className="h-3.5 w-3.5" />,
    });
    if (onRetry) actions.push({
      label: '重試發布', onClick: onRetry, icon: <RefreshCw className="h-3.5 w-3.5" />, variant: 'outline',
    });
  } else if (error.code === 'UNIT_CONFLICT') {
    if (onUseLockedUnit) actions.push({
      label: '改用歷史單位', onClick: onUseLockedUnit, icon: <ArrowRightLeft className="h-3.5 w-3.5" />,
    });
    if (onOpenRealign) actions.push({
      label: '執行改單位…', onClick: onOpenRealign, icon: <ArrowRightLeft className="h-3.5 w-3.5" />, variant: 'outline',
    });
    if (onRetry) actions.push({
      label: '重試', onClick: onRetry, icon: <RefreshCw className="h-3.5 w-3.5" />, variant: 'outline',
    });
  } else if (error.code === 'INCOMPATIBLE_UNIT') {
    if (onUseAllowedUnit) actions.push({
      label: '切換為相容單位', onClick: onUseAllowedUnit, icon: <ArrowRightLeft className="h-3.5 w-3.5" />,
    });
    if (onRetry) actions.push({
      label: '重試', onClick: onRetry, icon: <RefreshCw className="h-3.5 w-3.5" />, variant: 'outline',
    });
  } else {
    if (onRetry) actions.push({
      label: '重試', onClick: onRetry, icon: <RefreshCw className="h-3.5 w-3.5" />,
    });
    actions.push({
      label: '複製錯誤訊息',
      onClick: () => {
        navigator.clipboard?.writeText(error.raw).then(
          () => toast.success('已複製錯誤訊息'),
          () => toast.error('複製失敗'),
        );
      },
      icon: <Copy className="h-3.5 w-3.5" />,
      variant: 'outline',
    });
  }

  return (
    <div
      role="alert"
      data-testid="publish-error-banner"
      data-error-code={error.code}
      className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2"
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-semibold text-destructive">{error.title}</p>
          <p className="text-xs text-foreground/90 break-words">{error.detail}</p>
          <p className="text-[11px] text-muted-foreground break-words">{error.hint}</p>
        </div>
        {onDismiss && (
          <button
            type="button"
            aria-label="關閉錯誤提示"
            onClick={onDismiss}
            className="text-muted-foreground hover:text-foreground text-xs px-1"
          >
            ✕
          </button>
        )}
      </div>
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2 pl-6">
          {actions.map((a) => (
            <Button
              key={a.label}
              type="button"
              size="sm"
              variant={a.variant ?? 'default'}
              onClick={a.onClick}
              className="h-7 text-xs"
            >
              {a.icon}
              <span className="ml-1">{a.label}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
