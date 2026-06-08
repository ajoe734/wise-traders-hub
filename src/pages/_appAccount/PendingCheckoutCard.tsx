// W4-2: 顯示用戶最近 7 天 pending 的 payment_intents（未完成訂單）
// 提供「繼續付款」與「放棄」按鈕。
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShoppingCart } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface PendingIntent {
  id: string;
  trade_no: string;
  product_kind: string;
  plan_id: string | null;
  checkup_plan_id: string | null;
  expert_id: string | null;
  amount: number;
  billing_cycle: string;
  created_at: string;
  expert_plans?: { name: string; experts?: { name: string; slug: string } } | null;
  checkup_plans?: { name: string } | null;
}

export function PendingCheckoutCard() {
  const { user } = useAuth();
  const [intents, setIntents] = useState<PendingIntent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user?.id) return;
    setLoading(true);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('payment_intents' as any)
      .select('id, trade_no, product_kind, plan_id, checkup_plan_id, expert_id, amount, billing_cycle, created_at, expert_plans:plan_id(name, experts(name, slug)), checkup_plans:checkup_plan_id(name)')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    setIntents((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user?.id]);

  const handleResume = (intent: PendingIntent) => {
    let url = '/account';
    const cycle = intent.billing_cycle ? `&cycle=${intent.billing_cycle}` : '';
    if (intent.product_kind === 'expert_plan' && intent.expert_plans?.experts) {
      url = `/${intent.expert_plans.experts.slug}/checkout?plan=${intent.plan_id}${cycle}&utm_source=account&utm_campaign=resume`;
    } else if (intent.product_kind === 'checkup') {
      url = `/checkup/checkout?plan=${intent.checkup_plan_id}${cycle}&utm_source=account&utm_campaign=resume`;
    }
    window.location.href = url;
  };

  if (loading || intents.length === 0) return null;

  return (
    <Card className="border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <ShoppingCart className="h-4 w-4 text-amber-600" />
          您有 {intents.length} 筆未完成訂單
        </div>
        {intents.map((i) => {
          const name = i.product_kind === 'expert_plan'
            ? `${i.expert_plans?.experts?.name || ''} — ${i.expert_plans?.name || ''}`
            : `健檢 — ${i.checkup_plans?.name || ''}`;
          return (
            <div key={i.id} className="flex items-center justify-between gap-2 text-sm border-t pt-2 first:border-t-0 first:pt-0">
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{name}</div>
                <div className="text-xs text-muted-foreground">
                  NT${i.amount.toLocaleString()} · {new Date(i.created_at).toLocaleDateString('zh-TW')}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" onClick={() => handleResume(i)}>繼續付款</Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
