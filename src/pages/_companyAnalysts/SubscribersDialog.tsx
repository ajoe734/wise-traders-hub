import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { summarizeActiveSubscribers } from '@/lib/activeSubscribers';

interface Props {
  expert: { id: string; name: string } | null;
  onClose: () => void;
}

interface Row {
  id: string;
  user_id: string;
  status: string;
  billing_cycle: string;
  started_at: string;
  expires_at: string | null;
  plan: { name: string; plan_type: string } | null;
  profile: { display_name: string | null } | null;
  paid: boolean;
  excluded: boolean;
}

interface Result { rows: Row[]; paidCount: number; unpaidCount: number; yearly: number; monthly: number }

export function SubscribersDialog({ expert, onClose }: Props) {
  const { data, isLoading } = useQuery<Result>({
    queryKey: ['company-expert-subscribers', expert?.id],
    enabled: !!expert,
    queryFn: async () => {
      // 1. plans for this expert
      const { data: plans } = await supabase
        .from('expert_plans')
        .select('id, name, plan_type')
        .eq('expert_id', expert!.id);
      const planIds = (plans || []).map((p) => p.id);
      if (planIds.length === 0) return { rows: [], paidCount: 0, unpaidCount: 0, yearly: 0, monthly: 0 };
      const planMap = new Map((plans || []).map((p) => [p.id, p]));

      // 2. active subscriptions
      const nowIso = new Date().toISOString();
      const { data: subs } = await supabase
        .from('member_subscriptions')
        .select('id, user_id, plan_id, status, billing_cycle, started_at, expires_at')
        .in('plan_id', planIds)
        .eq('status', 'active')
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .order('started_at', { ascending: false });

      const list = subs || [];
      const userIds = Array.from(new Set(list.map((s) => s.user_id)));
      const subIds = list.map((s) => s.id);
      const [{ data: profs }, { data: txs }, { data: ex }] = await Promise.all([
        userIds.length ? supabase.from('profiles').select('user_id, display_name, is_tester').in('user_id', userIds) : Promise.resolve({ data: [] as any[] }),
        subIds.length ? supabase.from('payment_transactions').select('subscription_id').eq('status', 'paid').in('subscription_id', subIds) : Promise.resolve({ data: [] as any[] }),
        supabase.from('experts').select('user_id').eq('id', expert!.id).maybeSingle(),
      ]);
      const profMap = new Map((profs || []).map((p: any) => [p.user_id, p]));
      const paidSubs = new Set((txs || []).map((t: any) => t.subscription_id));
      const excluded = new Set((profs || []).filter((p: any) => p.is_tester).map((p: any) => p.user_id));
      const ownerId = (ex as any)?.user_id;
      const sum = summarizeActiveSubscribers(
        list.map((s: any) => ({ ...s, expert_id: expert!.id })), paidSubs, excluded, { [expert!.id]: ownerId }, Date.now(),
      )[expert!.id];
      const rows = list.map((s: any) => ({
        ...s,
        plan: planMap.get(s.plan_id) || null,
        profile: profMap.get(s.user_id) || null,
        paid: paidSubs.has(s.id),
        excluded: excluded.has(s.user_id) || s.user_id === ownerId,
      }));
      return { rows, paidCount: sum?.paidUsers.length ?? 0, unpaidCount: sum?.unpaidUsers.length ?? 0, yearly: sum?.yearly ?? 0, monthly: sum?.monthly ?? 0 };
    },
  });

  return (
    <Dialog open={!!expert} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{expert?.name} 的訂閱會員</DialogTitle>
        </DialogHeader>
        {data && (
          <div className="text-sm space-y-1" data-testid="subscriber-summary">
            <p>有效付費學員 <b>{data.paidCount}</b> 人（年繳 {data.yearly}・月繳 {data.monthly}）{data.unpaidCount > 0 && <>，另有未付款／贈送 {data.unpaidCount} 人</>}</p>
            <p className="text-xs text-muted-foreground">口徑：有效且未過期、依人去重、排除老師本人與測試帳號；與分析師列表學員數相同。下表逐筆列出所有有效訂閱。</p>
          </div>
        )}
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">載入中...</p>
        ) : !data || data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">尚無有效訂閱</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3">會員</th>
                  <th className="py-2 pr-3">方案</th>
                  <th className="py-2 pr-3">週期</th>
                  <th className="py-2 pr-3">開始</th>
                  <th className="py-2">到期</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{r.profile?.display_name || r.user_id.slice(0, 8)}
                      {!r.paid && <Badge variant="outline" className="ml-1 text-xs text-destructive">未付款</Badge>}
                      {r.excluded && <Badge variant="outline" className="ml-1 text-xs">不計入</Badge>}</td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline" className="text-xs">{r.plan?.name || '-'}</Badge>
                    </td>
                    <td className="py-2 pr-3">{r.billing_cycle === 'yearly' ? '年繳' : '月繳'}</td>
                    <td className="py-2 pr-3">{r.started_at?.slice(0, 10).replace(/-/g, '/')}</td>
                    <td className="py-2">{r.expires_at ? r.expires_at.slice(0, 10).replace(/-/g, '/') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
