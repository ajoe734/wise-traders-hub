import { Card, CardContent } from '@/components/ui/card';
import { Bell } from 'lucide-react';
import type { NotifyLog } from './types';
import { fmtDateTime } from './format';

export function NotifyIssueCard({ notifyLog }: { notifyLog: NotifyLog | null }) {
  if (!notifyLog) return null;
  if (notifyLog.email_failed === 0 && notifyLog.errors.length === 0) return null;
  return (
    <Card className="border-amber-200">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm font-medium mb-2">
          <Bell className="h-4 w-4 text-amber-600" />
          最近一次 Email 通知問題
        </div>
        <div className="text-xs text-muted-foreground mb-2">
          {fmtDateTime(notifyLog.created_at)}・成功 {notifyLog.email_sent}・失敗 {notifyLog.email_failed}
        </div>
        {notifyLog.errors.length > 0 && (
          <div className="space-y-1">
            {notifyLog.errors.slice(0, 5).map((e, i) => (
              <code key={i} className="block text-xs text-red-700 bg-red-50 px-2 py-1 rounded break-all">{e}</code>
            ))}
          </div>
        )}
        {notifyLog.email_failed > 0 && (
          <div className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
            💡 401 / API key invalid → 請至 Connectors 更新 <code>RESEND_API_KEY</code>。
          </div>
        )}
      </CardContent>
    </Card>
  );
}
