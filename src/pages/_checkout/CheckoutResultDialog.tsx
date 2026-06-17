import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { CheckCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { avatarUrl } from '@/lib/imageTransform';

export interface CheckoutResult {
  open: boolean;
  success: boolean;
  message?: string;
  canRetry?: boolean;
}

interface CheckoutResultDialogProps {
  resultDialog: CheckoutResult | null;
  expert: { name: string; avatar_url: string | null } | null;
  plan: { name: string } | null;
  billingCycle: 'monthly' | 'yearly';
  price: number;
  formatPrice: (p: number) => string;
  isAdvisor: boolean;
  onAction: () => void;
  onRetry?: () => void;
}

export function CheckoutResultDialog({
  resultDialog,
  expert,
  plan,
  billingCycle,
  price,
  formatPrice,
  isAdvisor,
  onAction,
  onRetry,
}: CheckoutResultDialogProps) {
  const showRetry = !resultDialog?.success && resultDialog?.canRetry !== false && !!onRetry;
  return (
    <AlertDialog open={resultDialog?.open ?? false} onOpenChange={() => {}}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {resultDialog?.success ? (
              <><CheckCircle className="h-5 w-5 text-green-500" />訂閱成功 🎉</>
            ) : (
              <><XCircle className="h-5 w-5 text-destructive" />訂閱失敗</>
            )}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-3">
                <img
                  src={avatarUrl(expert?.avatar_url, 80)}
                  alt={expert?.name}
                  loading="lazy"
                  decoding="async"
                  className="shrink-0 h-10 w-10 rounded-full object-cover object-[center_15%]"
                />
                <div>
                  <p className="font-medium text-foreground">{expert?.name}</p>
                  <p className="text-sm text-muted-foreground">{plan?.name}</p>
                </div>
              </div>
              <div className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">付款週期</span>
                  <span className="text-foreground">{billingCycle === 'monthly' ? '月繳' : '年繳'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">金額</span>
                  <span className="text-foreground font-medium">NT$ {formatPrice(price)}</span>
                </div>
              </div>
              {resultDialog?.success ? (
                <p className="text-sm text-muted-foreground">您現在可以前往帳號頁面綁定 LINE 以接收即時通知。</p>
              ) : (
                <p className="text-sm text-destructive">{resultDialog?.message || '付款處理時發生錯誤，請稍後再試。'}</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {showRetry && (
            <AlertDialogAction
              onClick={onRetry}
              data-testid="checkout-retry-button"
              className={cn(!isAdvisor && "bg-mentor hover:bg-mentor/90")}
            >
              重試付款
            </AlertDialogAction>
          )}
          <AlertDialogAction
            onClick={onAction}
            className={cn(
              showRetry ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                : (!isAdvisor && 'bg-mentor hover:bg-mentor/90'),
            )}
          >
            {resultDialog?.success ? '前往帳號頁' : showRetry ? '關閉' : '重試'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
