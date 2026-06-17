// 顯示使用者最近 30 天「失敗 / 棄單」的 payment_intents（status = 'abandoned'）。
// 提供「重試付款」按鈕，導回對應的 checkout 流程。
// 與 PendingCheckoutCard 區分：那邊處理 status='pending'（還可繼續），這邊處理已被回收標記為 abandoned 的訂單。
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { FeatureCard } from '@/components/ui/feature-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface FailedIntent {
  id: string;
  trade_no: string;
  product_kind: string;
  plan_id: string | null;
  checkup_plan_id: string | null;
  amount: number;
  billing_cycle: string;
  created_at: string;
  expert_plans?: { name: string; experts?: { name: string; slug: string } } | null;
  checkup_plans?: { name: string } | null;
}

export function FailedIntentsCard() {
  const { user } = useAuth();
  const [intents, setIntents] = useState<FailedIntent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('payment_intents' as any)
        .select('id, trade_no, product_kind, plan_id, checkup_plan_id, amount, billing_cycle, created_at, expert_plans:plan_id(name, experts(name, slug)), checkup_plans:checkup_plan_id(name)')
        .eq('user_id', user.id)
        .eq('status', 'abandoned')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(10);
      if (!cancelled) {
        setIntents((data as any) || []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  if (loading || intents.length === 0) return null;

  const handleRetry = (i: FailedIntent) => {
    const cycle = i.billing_cycle ? `?cycle=${i.billing_cycle}` : '';
    if (i.product_kind === 'expert_plan' && i.expert_plans?.experts?.slug && i.plan_id) {
      window.location.href = `/checkout/${i.expert_plans.experts.slug}/${i.plan_id}${cycle}`;
    } else if (i.product_kind === 'checkup' && i.checkup_plan_id) {
      window.location.href = `/checkout/checkup/${i.checkup_plan_id}${cycle}`;
    }
  };

  return (
    <div data-testid="failed-subscriptions-section">
    <FeatureCard className="p-4 border-destructive/40 bg-destructive/5">
      <div className="flex items-center gap-2 font-semibold text-sm mb-3">
        <AlertTriangle className="h-4 w-4 text-destructive" />
        失敗 / 未完成的訂閱
        <Badge variant="destructive" className="ml-auto text-[10px]">{intents.length}</Badge>
      </div>
      <div className="space-y-3">
        {intents.map((i) => {
          const name = i.product_kind === 'expert_plan'
            ? `${i.expert_plans?.experts?.name || ''} — ${i.expert_plans?.name || ''}`
            : `健檢 — ${i.checkup_plans?.name || ''}`;
          return (
            <div key={i.id} className="flex items-center justify-between gap-2 text-sm border-t pt-3 first:border-t-0 first:pt-0">
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{name}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">付款失敗</Badge>
                  <span>NT${i.amount.toLocaleString()}</span>
                  <span>·</span>
                  <span>{new Date(i.created_at).toLocaleDateString('zh-TW')}</span>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => handleRetry(i)} data-testid="failed-intent-retry">
                重試付款
              </Button>
            </div>
          );
        })}
      </div>
    </FeatureCard>
  );
}
