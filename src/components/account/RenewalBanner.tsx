// W4-1: 帳號頁續訂橫幅
// 顯示條件：任一訂閱 expires_at ≤ now+7d，或 status='expired' 且 expires_at > now-24h
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Clock, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { track } from '@/lib/analytics/events';

interface RenewSub {
  id: string;
  status: string;
  expires_at: string;
  plan_id: string;
  expert_plans?: {
    name: string;
    price_monthly: number;
    experts?: { name: string; slug: string };
  } | null;
}

export function RenewalBanner() {
  const { user } = useAuth();
  const [subs, setSubs] = useState<RenewSub[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const now = new Date();
      const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const ago24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

      const { data } = await supabase
        .from('member_subscriptions')
        .select('id, status, expires_at, plan_id, expert_plans(name, price_monthly, experts(name, slug))')
        .eq('user_id', user.id)
        .or(`and(status.eq.active,expires_at.lte.${in7d}),and(status.eq.expired,expires_at.gte.${ago24h})`)
        .is('canceled_at', null)
        .order('expires_at', { ascending: true });
      setSubs((data as any) || []);
    })();
  }, [user?.id]);

  if (subs.length === 0) return null;

  return (
    <div className="space-y-2">
      {subs.map((s) => {
        const expiresAt = new Date(s.expires_at);
        const ms = expiresAt.getTime() - Date.now();
        const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
        const expired = s.status === 'expired' || ms <= 0;
        const expert = s.expert_plans?.experts;
        const planName = `${expert?.name || ''} — ${s.expert_plans?.name || ''}`;
        const url = expert
          ? `/${expert.slug}/checkout?plan=${s.plan_id}&utm_source=account_banner&utm_campaign=renewal`
          : '/account';

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
                  {s.expert_plans?.price_monthly ? ` · 續訂 NT$${s.expert_plans.price_monthly.toLocaleString()}` : ''}
                </p>
              </div>
              <Button size="sm" asChild>
                <a href={url}>立即續訂</a>
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
