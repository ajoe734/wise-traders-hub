/**
 * HoldingDeleteDialog — 單檔持倉刪除的明確確認視窗。
 *
 * 文案硬合約：明確說明「只把這一檔移出目前持倉，不會建立賣出交易、
 * 不會更動交易紀錄與資金」。使用者必須明確按下確認才會刪。
 */
import { useState } from 'react';
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

export interface HoldingDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
  name?: string;
  onConfirm: () => Promise<void> | void;
}

export default function HoldingDeleteDialog({ open, onOpenChange, code, name, onConfirm }: HoldingDeleteDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <AlertDialogContent data-testid="holding-delete-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>刪除持倉 {code}{name ? ` ${name}` : ''}？</AlertDialogTitle>
          <AlertDialogDescription data-testid="holding-delete-confirm-copy">
            這只會把這一檔從「目前持倉」移除，<strong>不會建立賣出交易</strong>，
            也不會更動你的交易紀錄、已實現損益或帳戶資金。
            之後重新加入這一檔，就會自動恢復顯示。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="holding-delete-cancel" disabled={busy}>取消</AlertDialogCancel>
          <AlertDialogAction
            data-testid="holding-delete-confirm"
            disabled={busy}
            onClick={async (e) => {
              e.preventDefault();
              setBusy(true);
              try { await onConfirm(); } finally { setBusy(false); onOpenChange(false); }
            }}
          >確認刪除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
