import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  open: boolean;
  rejectNote: string;
  acting: boolean;
  setOpen: (v: boolean) => void;
  setRejectNote: (v: string) => void;
  onSubmit: () => void;
}

export default function RejectDialog({ open, rejectNote, acting, setOpen, setRejectNote, onSubmit }: Props) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>退回方案</DialogTitle>
          <DialogDescription>
            請填寫退回原因，分析師將在後台看到此說明，並可修改後重新送審。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>退回原因</Label>
          <Textarea
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            rows={4}
            placeholder="例：方案描述不夠清楚 / 價格與類型不符 / 亮點過於誇大"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={onSubmit} disabled={acting} variant="destructive">
            {acting ? '處理中…' : '確認退回'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
