import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveUserId } from '@/hooks/useEffectiveUserId';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';
import { format } from 'date-fns';

/**
 * Shows a notice on /app/account and /app/subscribed when the current user's most
 * recent account-merge (within 60 days) cancelled overlapping active subscriptions.
 * The kept row + canceled rows come from `account_merges.moved_counts._sub_conflicts`,
 * populated by account-link-consume and admin-account-force-merge.
 */
interface ConflictGroup {
  plan_id: string;
  kept: { id: string; user_id: string; expires_at: string | null };
  canceled: Array<{ id: string; user_id: string; expires_at: string | null }>;
}

interface EnrichedGroup extends ConflictGroup {
  plan_name?: string;
  expert_name?: string;
}

const NOTICE_WINDOW_DAYS = 60;

export function SubscriptionConflictNotice() {
  const { userId } = useEffectiveUserId();
  const [groups, setGroups] = useState<EnrichedGroup[]>([]);
  const [mergedAt, setMergedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const since = new Date(Date.now() - NOTICE_WINDOW_DAYS * 86400_000).toISOString();
      const { data: merge } = await supabase
        .from('account_merges')
        .select('id, created_at, moved_counts')
        .eq('primary_user_id', userId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!merge || cancelled) return;
      const raw = ((merge.moved_counts as any)?._sub_conflicts ?? []) as ConflictGroup[];
      if (!raw.length) return;

      const planIds = Array.from(new Set(raw.map((g) => g.plan_id)));
      const { data: plans } = await supabase
        .from('expert_plans')
        .select('id, name, experts(name)')
        .in('id', planIds);
      const planMap = new Map(
        (plans ?? []).map((p: any) => [p.id, { plan_name: p.name, expert_name: p.experts?.name }]),
      );
      if (cancelled) return;
      setMergedAt(merge.created_at);
      setGroups(raw.map((g) => ({ ...g, ...(planMap.get(g.plan_id) ?? {}) })));
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (!groups.length) return null;

  return (
    <Card className="border-amber-400/60 bg-amber-50/60 dark:bg-amber-950/20">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold">帳號合併已完成訂閱調整</p>
            <p className="text-muted-foreground mt-0.5">
              {mergedAt ? `於 ${format(new Date(mergedAt), 'yyyy/MM/dd HH:mm')} 合併時，` : ''}
              同一位專家有重複的有效訂閱，系統已為您保留到期日最晚的一筆，其餘已自動取消（不影響已付款金額）。
            </p>
          </div>
        </div>
        <ul className="space-y-2 text-sm">
          {groups.map((g) => (
            <li key={g.plan_id} className="rounded-md border border-amber-200/70 dark:border-amber-800/60 bg-background/60 p-3">
              <p className="font-medium">
                {g.expert_name ?? '（未知專家）'} · {g.plan_name ?? `方案 #${g.plan_id.slice(0, 8)}`}
              </p>
              <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
                保留：到期日 {g.kept.expires_at ? format(new Date(g.kept.expires_at), 'yyyy/MM/dd') : '未設定'}
              </p>
              {g.canceled.map((c) => (
                <p key={c.id} className="text-xs text-muted-foreground mt-0.5">
                  已取消：到期日 {c.expires_at ? format(new Date(c.expires_at), 'yyyy/MM/dd') : '未設定'}
                </p>
              ))}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
