import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Bell } from 'lucide-react';

type NotifType = 'info' | 'success' | 'warning';

interface Recipient {
  user_id: string;
  display_name?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recipients: Recipient[];
  onSent?: () => void;
}

export function PlatformNotifyDialog({ open, onOpenChange, recipients, onSent }: Props) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState<NotifType>('info');
  const [link, setLink] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const uniqueRecipients = Array.from(
    new Map(recipients.map((r) => [r.user_id, r])).values()
  );
  const total = uniqueRecipients.length;

  const reset = () => {
    setTitle(''); setBody(''); setType('info'); setLink('');
  };

  const handleSubmit = async () => {
    if (!title.trim()) { toast.error('請輸入標題'); return; }
    if (total === 0) { toast.error('請選擇至少一位收件人'); return; }
    setSubmitting(true);
    try {
      const rows = uniqueRecipients.map((r) => ({
        user_id: r.user_id,
        title: title.trim(),
        body: body.trim() || null,
        type,
        link: link.trim() || null,
      }));
      const { error } = await supabase.from('notifications').insert(rows);
      if (error) throw error;
      toast.success(`已送出 ${rows.length} 則站內通知`);
      reset();
      onOpenChange(false);
      onSent?.();
    } catch (e: any) {
      toast.error('送出失敗：' + (e?.message || String(e)));
    } finally {
      setSubmitting(false);
    }
  };

  const previewNames = uniqueRecipients.slice(0, 3).map((r) => r.display_name || r.user_id.slice(0, 8)).join('、');
  const extraCount = Math.max(0, total - 3);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bell className="h-4 w-4" />站內通知</DialogTitle>
          <DialogDescription>
            收件人 <Badge variant="outline">{total} 位</Badge>
            {total > 0 && (
              <span className="ml-2 text-xs text-muted-foreground">
                {previewNames}{extraCount > 0 ? ` 等 ${total} 人` : ''}
              </span>
            )}
            <span className="block mt-1 text-xs text-muted-foreground">會員登入後可在鈴鐺與提醒中心看到，不會發送 Line。</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">類型</Label>
            <RadioGroup value={type} onValueChange={(v) => setType(v as NotifType)} className="flex gap-4 mt-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="info" /> 一般
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="success" /> 成功
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="warning" /> 警示
              </label>
            </RadioGroup>
          </div>

          <div>
            <Label className="text-xs">標題（必填）</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="例：新版持倉看板上線" />
            <div className="text-xs text-muted-foreground mt-1">{title.length} / 80</div>
          </div>

          <div>
            <Label className="text-xs">內容（選填）</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={500} placeholder="補充說明..." />
            <div className="text-xs text-muted-foreground mt-1">{body.length} / 500</div>
          </div>

          <div>
            <Label className="text-xs">點擊連結（選填）</Label>
            <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="/holding-checkup 或 https://..." />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting || !title.trim() || total === 0}>
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Bell className="h-4 w-4 mr-2" />}
            送出通知
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
