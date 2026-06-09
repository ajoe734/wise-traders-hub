import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, Send, Calendar } from 'lucide-react';

type Kind = 'text' | 'text_with_action' | 'image';

interface Recipient {
  user_id: string;
  display_name?: string;
  has_line: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recipients: Recipient[];
  onSent?: () => void;
}

function toLocalDatetimeInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LinePushDialog({ open, onOpenChange, recipients, onSent }: Props) {
  const { user } = useAuth();
  const [kind, setKind] = useState<Kind>('text');
  const [text, setText] = useState('');
  const [actionLabel, setActionLabel] = useState('查看');
  const [actionUrl, setActionUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [schedule, setSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(toLocalDatetimeInput(new Date(Date.now() + 5 * 60 * 1000)));
  const [submitting, setSubmitting] = useState(false);

  const totalCount = recipients.length;
  const boundCount = recipients.filter((r) => r.has_line).length;
  const skipCount = totalCount - boundCount;

  const reset = () => {
    setKind('text'); setText(''); setActionLabel('查看'); setActionUrl(''); setImageUrl('');
    setSchedule(false); setScheduledAt(toLocalDatetimeInput(new Date(Date.now() + 5 * 60 * 1000)));
  };

  const handleSubmit = async () => {
    if (!user) { toast.error('未登入'); return; }
    if (boundCount === 0) { toast.error('收件人皆未綁定 Line'); return; }
    if (kind === 'text' || kind === 'text_with_action') {
      if (!text.trim()) { toast.error('請輸入訊息文字'); return; }
    }
    if (kind === 'text_with_action' && !actionUrl.trim()) {
      toast.error('請輸入按鈕連結'); return;
    }
    if (kind === 'image' && !imageUrl.trim()) {
      toast.error('請輸入圖片 URL'); return;
    }

    setSubmitting(true);
    try {
      const recipient_user_ids = recipients.filter((r) => r.has_line).map((r) => r.user_id);
      const payload: any = {
        created_by: user.id,
        recipient_user_ids,
        message_kind: kind,
        text: kind === 'image' ? null : text,
        action_label: kind === 'text_with_action' ? actionLabel : null,
        action_url: kind === 'text_with_action' ? actionUrl : null,
        image_url: kind === 'image' ? imageUrl : null,
        scheduled_at: schedule ? new Date(scheduledAt).toISOString() : null,
        status: 'pending',
      };
      const { data: job, error } = await supabase
        .from('line_push_jobs')
        .insert(payload)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!job) throw new Error('insert failed');

      if (schedule) {
        toast.success(`已排程，將於 ${new Date(scheduledAt).toLocaleString('zh-TW')} 發送`);
      } else {
        const { data: result, error: invokeErr } = await supabase.functions.invoke('admin-line-push', {
          body: { job_id: job.id },
        });
        if (invokeErr) throw invokeErr;
        const r: any = result || {};
        if (r.ok) {
          toast.success(`推播完成：成功 ${r.sent || 0}，失敗 ${r.failed || 0}，略過 ${r.skipped || 0}`);
        } else {
          toast.error(`推播失敗：${r.reason || 'unknown'}`);
        }
      }
      reset();
      onOpenChange(false);
      onSent?.();
    } catch (e: any) {
      toast.error('送出失敗：' + (e?.message || String(e)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Line 推播</DialogTitle>
          <DialogDescription>
            收件人 <Badge variant="outline">{boundCount} 位可送達</Badge>
            {skipCount > 0 && <Badge variant="outline" className="ml-2 text-muted-foreground">{skipCount} 位無 Line 綁定，將略過</Badge>}
            <span className="block mt-1 text-xs text-destructive">⚠️ 強制發送，不檢查用戶通知偏好</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">訊息類型</Label>
            <RadioGroup value={kind} onValueChange={(v) => setKind(v as Kind)} className="flex gap-4 mt-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="text" /> 純文字
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="text_with_action" /> 文字 + 按鈕
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="image" /> 圖片
              </label>
            </RadioGroup>
          </div>

          {(kind === 'text' || kind === 'text_with_action') && (
            <div>
              <Label className="text-xs">文字內容</Label>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                maxLength={2000}
                placeholder="輸入推播訊息..."
              />
              <div className="text-xs text-muted-foreground mt-1">{text.length} / 2000</div>
            </div>
          )}

          {kind === 'text_with_action' && (
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-1">
                <Label className="text-xs">按鈕文字</Label>
                <Input value={actionLabel} onChange={(e) => setActionLabel(e.target.value)} maxLength={20} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">按鈕連結 URL</Label>
                <Input value={actionUrl} onChange={(e) => setActionUrl(e.target.value)} placeholder="https://..." />
              </div>
            </div>
          )}

          {kind === 'image' && (
            <div>
              <Label className="text-xs">圖片 URL（須為 HTTPS，jpg/png）</Label>
              <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." />
              {imageUrl && <img src={imageUrl} alt="" className="mt-2 max-h-40 rounded border" />}
            </div>
          )}

          <div className="border-t pt-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={schedule}
                onChange={(e) => setSchedule(e.target.checked)}
                className="rounded"
              />
              <Calendar className="h-4 w-4" />
              排程發送
            </label>
            {schedule && (
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="mt-2 max-w-xs"
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting || boundCount === 0}>
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            {schedule ? '建立排程' : '立即推播'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
