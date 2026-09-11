import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DEFAULT_JOURNAL_REMINDER_TIME,
  DEFAULT_JOURNAL_REMINDER_TIMEZONE,
  isValidReminderTime,
  isValidTimezone,
  normalizeReminderTime,
} from '@/lib/subscriberExpiryReminder';

interface Props {
  expert: any | null;
  saving: boolean;
  onClose: () => void;
  onSave: (expertId: string, values: { journal_reminder_time: string; journal_reminder_timezone: string }) => Promise<void>;
}

/** 分析師管理 → 每日週記撰寫提醒時間（訂閱者到期彙總通知於此時間送達）。 */
export function ReminderTimeDialog({ expert, saving, onClose, onSave }: Props) {
  const [time, setTime] = useState(DEFAULT_JOURNAL_REMINDER_TIME);
  const [tz, setTz] = useState(DEFAULT_JOURNAL_REMINDER_TIMEZONE);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!expert) return;
    setSaveError(null);
    setTime(normalizeReminderTime(expert.journal_reminder_time));
    setTz(expert.journal_reminder_timezone || DEFAULT_JOURNAL_REMINDER_TIMEZONE);
  }, [expert]);

  const handleSave = async () => {
    if (!expert) return;
    setSaveError(null);
    try {
      await onSave(expert.id, { journal_reminder_time: time, journal_reminder_timezone: tz.trim() });
    } catch (err: any) {
      const raw = String(err?.message || err || '');
      const schemaMissing = /column|schema cache|does not exist|PGRST204/i.test(raw);
      setSaveError(
        schemaMissing
          ? '尚未完成資料庫更新，暫時無法儲存提醒時間，請稍後再試。'
          : `儲存失敗：${raw || '請稍後再試'}`,
      );
    }
  };

  const timeOk = isValidReminderTime(time);
  const tzOk = isValidTimezone(tz);

  return (
    <Dialog open={!!expert} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>每日撰寫提醒時間{expert?.name ? `・${expert.name}` : ''}</DialogTitle>
          <DialogDescription>
            訂閱者即將到期（7 日內）的彙總提醒會在此時間後的下一個整點 5 分送達站內通知；同一天只發一則。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="reminder-time">提醒時間（24 小時制）</Label>
            <Input id="reminder-time" type="time" step={60} value={time} onChange={(e) => setTime(e.target.value)} />
            {!timeOk && <p className="text-xs text-destructive">請輸入 HH:MM</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="reminder-tz">時區（IANA）</Label>
            <Input id="reminder-tz" value={tz} onChange={(e) => setTz(e.target.value)} placeholder="Asia/Taipei" />
            {!tzOk && <p className="text-xs text-destructive">無效的時區名稱，例如 Asia/Taipei</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>取消</Button>
          <Button
            disabled={saving || !timeOk || !tzOk || !expert}
            onClick={() => expert && onSave(expert.id, { journal_reminder_time: time, journal_reminder_timezone: tz.trim() })}
          >
            {saving ? '儲存中…' : '儲存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
