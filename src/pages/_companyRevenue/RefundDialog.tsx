import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { fmtMoney } from './utils';

interface Props {
  refundingTx: any | null;
  refundReason: string;
  setRefundReason: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function RefundDialog({ refundingTx, refundReason, setRefundReason, onClose, onConfirm }: Props) {
  return (
    <AlertDialog open={!!refundingTx} onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>確認退款</AlertDialogTitle>
          <AlertDialogDescription>
            將對交易 {refundingTx?.provider_tx_id || refundingTx?.id?.slice(0, 8)} 進行退款，金額 {fmtMoney(refundingTx?.amount || 0)}。
            注意：退款只會更新交易狀態，<strong>不會反沖 revenue_splits 的分潤紀錄</strong>，請於對帳時手動扣除。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-2">
          <Label>退款原因</Label>
          <Textarea value={refundReason} onChange={e => setRefundReason(e.target.value)} placeholder="請填寫退款原因..." rows={3} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-company hover:bg-company/90 text-white">確認退款</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
