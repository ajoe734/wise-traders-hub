import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';

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
}

export function SubscribersDialog({ expert, onClose }: Props) {
  const { data = [], isLoading } = useQuery<Row[]>({
    queryKey: ['company-expert-subscribers', expert?.id],
    enabled: !!expert,
    queryFn: async () => {
      // 1. plans for this expert
      const { data: plans } = await supabase
        .from('expert_plans')
        .select('id, name, plan_type')
        .eq('expert_id', expert!.id);
      const planIds = (plans || []).map((p) => p.id);
      if (planIds.length === 0) return [];
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

      const userIds = Array.from(new Set((subs || []).map((s) => s.user_id)));
      // 3. profiles
      const { data: profs } = userIds.length
        ? await supabase.from('profiles').select('user_id, display_name').in('user_id', userIds)
        : { data: [] as any[] };
      const profMap = new Map((profs || []).map((p: any) => [p.user_id, p]));

      return (subs || []).map((s: any) => ({
        ...s,
        plan: planMap.get(s.plan_id) || null,
        profile: profMap.get(s.user_id) || null,
      }));
    },
  });

  return (
    <Dialog open={!!expert} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{expert?.name} 的訂閱會員（{data.length}）</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">載入中...</p>
        ) : data.length === 0 ? (
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
                {data.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{r.profile?.display_name || r.user_id.slice(0, 8)}</td>
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
