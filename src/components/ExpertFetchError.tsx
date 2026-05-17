import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * 一致的 experts/useExpert/useExpertDetailBundle 失敗 UI。
 *
 * 設計原則：
 *  - 只在「沒有任何 cache 可顯示」時整頁 takeover；只要有 stale data，
 *    就靠 `placeholderData: keepPreviousData` 讓畫面照常顯示，這個 banner
 *    僅以細條形式提示「最新一次更新失敗、可重試」。
 *  - 重試按鈕呼叫 React Query 提供的 refetch，會走完整的 retry 鏈
 *    （expertRetry/expertRetryDelay），所以使用者不必狂點。
 */
type Props = {
  /** React Query 拋出的 error（可選，僅用於顯示原因） */
  error?: unknown;
  /** React Query 的 refetch */
  onRetry: () => void;
  /** 是否正在重試中 */
  isRetrying?: boolean;
  /**
   * 'full' — 整頁置中（沒有 stale cache 可顯示時用）
   * 'inline' — 細條 banner（仍有 stale data 顯示時用）
   */
  variant?: 'full' | 'inline';
  /** 自訂中文訊息（不填用預設） */
  message?: string;
};

function errMessage(err: unknown): string {
  if (!err) return '';
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err && 'message' in err) {
    return String((err as { message?: unknown }).message ?? '');
  }
  return String(err);
}

export function ExpertFetchError({
  error,
  onRetry,
  isRetrying = false,
  variant = 'full',
  message,
}: Props) {
  const detail = errMessage(error);

  if (variant === 'inline') {
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
      >
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{message ?? '最新資料更新失敗，顯示的是先前快取。'}</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onRetry}
          disabled={isRetrying}
          aria-label="重新載入專家資料"
        >
          {isRetrying ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-1.5">重試</span>
        </Button>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="container py-12 flex flex-col items-center justify-center text-center gap-4"
    >
      <AlertCircle className="h-10 w-10 text-destructive" />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{message ?? '專家資料載入失敗'}</h2>
        <p className="text-sm text-muted-foreground">
          請檢查網路連線後重試。
          {detail && (
            <span className="block mt-1 text-xs opacity-70">{detail}</span>
          )}
        </p>
      </div>
      <Button onClick={onRetry} disabled={isRetrying} aria-label="重新載入">
        {isRetrying ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 h-4 w-4" />
        )}
        重新載入
      </Button>
    </div>
  );
}
