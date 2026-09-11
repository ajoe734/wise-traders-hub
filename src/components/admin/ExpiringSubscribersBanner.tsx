import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { CalendarClock, ChevronDown, ChevronUp, X } from 'lucide-react';
import { createPrefsStore } from '@/checkup/lib/prefsStore';
import { useExpiringSubscribers } from '@/hooks/useExpiringSubscribers';
import {
  daysLeftLabel,
  dismissKey,
  formatExpiresOn,
  pruneDismissed,
  reminderTitle,
  shouldShowBanner,
} from '@/lib/subscriberExpiryReminder';

type Prefs = { dismissed: string[] };
const prefs = createPrefsStore<Prefs>({
  key: 'lf.expiringSubscribersBanner.v1',
  defaults: { dismissed: [] },
  sanitize: (v) => ({ dismissed: Array.isArray(v.dismissed) ? v.dismissed.filter((x) => typeof x === 'string') : [] }),
});

interface Props {
  expertId: string | null | undefined;
  expertSlug?: string | null;
  /** 唯讀（view-as / 非 owner admin）時不顯示「收起」以外的操作；預設顯示 */
  enabled?: boolean;
}

/**
 * 週記撰寫頁頂部：與每日站內通知同一批「即將到期訂閱者」（同一 RPC 為資料源）。
 * 只顯示 display name / 方案 / 到期日 / 剩餘天數；不顯示 email / LINE。
 */
export function ExpiringSubscribersBanner({ expertId, expertSlug, enabled = true }: Props) {
  const { data: rows, isLoading, error } = useExpiringSubscribers(expertId, enabled);
  const [dismissed, setDismissed] = useState<string[]>(() => prefs.load().dismissed);
  const [expanded, setExpanded] = useState(false);

  if (!enabled || isLoading || error || !shouldShowBanner({ rows, dismissed, expertId })) return null;
  const list = rows!;
  const localDate = list[0].local_date;
  const visible = expanded ? list : list.slice(0, 3);

  const dismiss = () => {
    const next = [...pruneDismissed(dismissed, localDate), dismissKey(expertId!, localDate)];
    prefs.save({ dismissed: next });
    setDismissed(next);
  };

  return (
    <section
      role="status"
      aria-label="訂閱者即將到期提醒"
      data-testid="expiring-subscribers-banner"
      className="rounded-md border border-border bg-muted/40 px-4 py-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <CalendarClock className="h-4 w-4 mt-0.5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{reminderTitle(list.length)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">續訂關懷提醒：建議在今天的週記中多一句關心，提醒他們續訂。</p>
            <ul className="mt-2 space-y-1" data-testid="expiring-subscribers-list">
              {visible.map((r) => (
                <li key={r.subscription_id} className="text-sm flex flex-wrap gap-x-2 gap-y-0.5" data-testid="expiring-subscriber-item">
                  <span className="font-semibold text-foreground">{r.display_name}</span>
                  <span className="text-muted-foreground">{r.plan_name || '訂閱方案'}</span>
                  <span className="text-muted-foreground">{formatExpiresOn(r.expires_on)}</span>
                  <span className={r.days_left <= 1 ? 'text-destructive font-medium' : 'text-foreground'}>{daysLeftLabel(r.days_left)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-center gap-3">
              {list.length > 3 && (
                <button type="button" className="text-xs text-primary inline-flex items-center gap-1" onClick={() => setExpanded((v) => !v)}>
                  {expanded ? <><ChevronUp className="h-3 w-3" />收合</> : <><ChevronDown className="h-3 w-3" />顯示全部 {list.length} 位</>}
                </button>
              )}
              {expertSlug && (
                <Link to={`/admin/${expertSlug}/subscribers`} className="text-xs text-primary underline-offset-2 hover:underline">
                  查看訂閱者
                </Link>
              )}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="今天先收起" onClick={dismiss}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}
