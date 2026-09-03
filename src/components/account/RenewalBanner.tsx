// W4-1: 帳號頁續訂橫幅
// 顯示條件：
//   - 月訂閱：expires_at ≤ now+7d
//   - 年訂閱：expires_at ≤ now+30d
//   - 任一週期：expired 且 expires_at > now-24h（24h 回購窗）
// 金額與續訂連結依 billing_cycle 顯示對應月費/年費。
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Clock, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useEffectiveUserId } from '@/hooks/useEffectiveUserId';
import { track } from '@/lib/analytics/events';

interface RenewSub {
  id: string;
  status: string;
  expires_at: string;
  plan_id: string;
  billing_cycle: string | null;
  expert_plans?: {
    name: string;
    price_monthly: number;
    price_yearly: number | null;
    experts?: { name: string; slug: string };
  } | null;
}

export function RenewalBanner() {
  const { user } = useAuth();
  const { userId: effectiveUserId } = useEffectiveUserId();
  const [subs, setSubs] = useState<RenewSub[]>([]);

  useEffect(() => {
    if (!effectiveUserId) return;
    (async () => {
      const now = new Date();
      // 抓 30 天內到期 + 24h 內過期，再用 cycle 篩
      const in30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const ago24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

      const { data } = await supabase
        .from('member_subscriptions')
        .select('id, status, expires_at, plan_id, billing_cycle, expert_plans(name, price_monthly, price_yearly, experts(name, slug))')
        .eq('user_id', effectiveUserId)
        .or(`and(status.eq.active,expires_at.lte.${in30d}),and(status.eq.expired,expires_at.gte.${ago24h})`)
        .is('canceled_at', null)
        .order('expires_at', { ascending: true });

      const nowMs = Date.now();
      const rows = ((data as any[]) || []);
      // 已續約：同一 plan 另有尚未到期的 active 訂閱時，不再顯示到期／回購提醒
      const { data: activeRows } = await supabase
        .from('member_subscriptions')
        .select('plan_id, expires_at, status')
        .eq('user_id', effectiveUserId)
        .eq('status', 'active')
        .is('canceled_at', null);
      const renewedPlanIds = new Set(
        ((activeRows as any[]) || [])
          .filter((r) => !r.expires_at || new Date(r.expires_at).getTime() > nowMs)
          .map((r) => r.plan_id),
      );
      const filtered = rows.filter((s) => {
        if (renewedPlanIds.has(s.plan_id) && new Date(s.expires_at).getTime() <= nowMs) return false;
        const cycle = s.billing_cycle === 'yearly' ? 'yearly' : 'monthly';
        const msLeft = new Date(s.expires_at).getTime() - nowMs;
        // 硬規則：真的超過 24h 回購窗，就不再顯示此橫幅（避免誤寫「24H 內」文案）
        if (msLeft < -24 * 3600 * 1000) return false;
        const days = msLeft / 86400000;
        if (s.status === 'expired' || msLeft <= 0) return true;
        const threshold = cycle === 'yearly' ? 30 : 7;
        return days <= threshold;
      });
      setSubs(filtered);
    })();
  }, [effectiveUserId]);

  if (subs.length === 0) return null;

  return (
    <div className="space-y-2">
      {subs.map((s) => {
        const expiresAt = new Date(s.expires_at);
        const ms = expiresAt.getTime() - Date.now();
        const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
        const expired = s.status === 'expired' || ms <= 0;
        const expert = s.expert_plans?.experts;
        const cycle = s.billing_cycle === 'yearly' ? 'yearly' : 'monthly';
        const amount = cycle === 'yearly'
          ? (s.expert_plans?.price_yearly ?? ((s.expert_plans?.price_monthly ?? 0) * 12))
          : (s.expert_plans?.price_monthly ?? 0);
        const unit = cycle === 'yearly' ? '/年' : '/月';
        const planName = `${expert?.name || ''} — ${s.expert_plans?.name || ''}`;
        const url = expert
          ? `/app/checkout/${expert.slug}/${s.plan_id}?cycle=${cycle}&utm_source=account_banner&utm_campaign=renewal`
          : '/app/account';

        return (
          <Card key={s.id} className={expired ? 'border-red-500/60 bg-red-50/40 dark:bg-red-950/20' : 'border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20'}>
            <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm space-y-0.5 min-w-0">
                <p className="font-medium flex items-center gap-1.5">
                  {expired
                    ? <><AlertTriangle className="h-4 w-4 text-red-600" /> {planName}：已過期 — 24h 內回購保留歷史資料</>
                    : <><Clock className="h-4 w-4 text-amber-600" /> {planName}：剩 {days} 天到期</>}
                </p>
                <p className="text-muted-foreground text-xs">
                  到期日 {expiresAt.toLocaleDateString('zh-TW')}
                  {amount > 0 ? ` · 續訂 NT$${amount.toLocaleString()}${unit}` : ''}
                </p>
              </div>
              <Button size="sm" asChild>
                <Link to={url} onClick={() => track('checkup_upgrade_click', { from: 'renewal_banner' })}>立即續訂</Link>
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
