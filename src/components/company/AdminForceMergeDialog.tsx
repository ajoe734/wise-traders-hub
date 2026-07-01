import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  primaryUserId: string;
  primaryLabel: string;
};

export function AdminForceMergeDialog({ open, onOpenChange, primaryUserId, primaryLabel }: Props) {
  const [secondaryId, setSecondaryId] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const target = secondaryId.trim();
    if (!/^[0-9a-f-]{36}$/i.test(target)) {
      toast.error('請輸入正確的副帳號 user_id (UUID)');
      return;
    }
    if (target === primaryUserId) { toast.error('主帳號與副帳號相同'); return; }
    if (confirmText !== 'MERGE') { toast.error('請在確認欄輸入 MERGE'); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-account-force-merge', {
        body: { primary_user_id: primaryUserId, secondary_user_id: target },
      });
      if (error) throw error;
      const payload = data as { error?: string; moved_counts?: Record<string, number> };
      if (payload?.error) throw new Error(payload.error);
      const total = Object.values(payload.moved_counts ?? {}).reduce((a, b) => a + Math.max(0, b), 0);
      toast.success(`合併完成，共搬移 ${total} 筆資料`);
      onOpenChange(false);
      setSecondaryId(''); setConfirmText('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`合併失敗：${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            代客綁定（合併副帳號到此會員）
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md bg-muted/50 p-3 space-y-1">
            <div>主帳號（保留）：<span className="font-mono text-xs">{primaryUserId}</span></div>
            <div className="text-muted-foreground">{primaryLabel}</div>
          </div>
          <p className="text-amber-700 dark:text-amber-400">
            ⚠️ 副帳號的所有訂閱、持倉、額度、通知會全部搬到主帳號，副帳號將被永久停用、無法登入。此動作無法自動還原。
          </p>
          <div className="space-y-1">
            <Label>副帳號 user_id（會被合併掉的那個）</Label>
            <Input
              value={secondaryId}
              onChange={(e) => setSecondaryId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label>輸入 MERGE 確認</Label>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="MERGE" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            執行合併
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
