import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface EarlyPublishDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pendingCount: number;
  publishMomentLabel: string;
  submitting: boolean;
  onConfirm: () => void | Promise<void>;
}

export function EarlyPublishDialog({
  open,
  onOpenChange,
  pendingCount,
  publishMomentLabel,
  submitting,
  onConfirm,
}: EarlyPublishDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>提前開放本週發布？</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                本週共 <span className="font-semibold text-foreground">{pendingCount}</span> 筆待發布週記將立即公開給訂閱者，並觸發 LINE 推播。
              </p>
              <p>此動作將繞過「{publishMomentLabel}」的自動排程；發布後 24 小時內可收回當日訊號。</p>
              <p className="text-destructive">請確認週記內容、單位與方向皆無誤後再提前發布。</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
          <AlertDialogAction disabled={submitting} onClick={onConfirm}>
            {submitting ? '發布中…' : '確認提前發布'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
