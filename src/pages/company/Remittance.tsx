import { SEO } from '@/components/SEO';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { logAdminAction } from '@/lib/auditLog';

interface Order {
  id: string;
  user_id: string;
  product_kind: string;
  plan_id: string | null;
  checkup_plan_id: string | null;
  billing_cycle: string;
  amount: number;
  original_amount: number | null;
  discount_amount: number | null;
  discount_reason: string | null;
  last5: string;
  payer_name: string;
  status: string;
  created_at: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
  reject_reason: string | null;
}

export default function CompanyRemittance() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'awaiting_info' | 'pending' | 'confirmed' | 'rejected' | 'expired' | 'all'>('pending');
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['company', 'remittance', filter],
    queryFn: async () => {
      let q = supabase.from('remittance_orders').select('*').order('created_at', { ascending: false });
      if (filter !== 'all') q = q.eq('status', filter);
      const { data, error } = await q;
      if (error) throw error;
      const list = (data || []) as Order[];
      const planIds = [...new Set(list.map(o => o.plan_id).filter(Boolean))] as string[];
      const checkupIds = [...new Set(list.map(o => o.checkup_plan_id).filter(Boolean))] as string[];
      const adminIds = [...new Set(list.map(o => o.confirmed_by).filter(Boolean))] as string[];
      const [pRes, cpRes, profRes] = await Promise.all([
        planIds.length ? supabase.from('expert_plans').select('id, name, experts(name, slug)').in('id', planIds) : Promise.resolve({ data: [] as any }),
        checkupIds.length ? supabase.from('checkup_plans').select('id, name').in('id', checkupIds) : Promise.resolve({ data: [] as any }),
        adminIds.length ? supabase.from('profiles').select('user_id, display_name').in('user_id', adminIds) : Promise.resolve({ data: [] as any }),
      ]);
      return {
        orders: list,
        planMap: Object.fromEntries(((pRes.data as any[]) || []).map(p => [p.id, p.name])) as Record<string, string>,
        expertMap: Object.fromEntries(((pRes.data as any[]) || []).map(p => [p.id, p.experts?.name || null])) as Record<string, string | null>,
        checkupPlanMap: Object.fromEntries(((cpRes.data as any[]) || []).map(p => [p.id, p.name])) as Record<string, string>,
        adminMap: Object.fromEntries(((profRes.data as any[]) || []).map(p => [p.user_id, p.display_name || p.user_id.slice(0, 8)])) as Record<string, string>,

      };
    },
    staleTime: 30_000,
  });
  const orders = data?.orders ?? [];
  const planMap = data?.planMap ?? {};
  const expertMap = data?.expertMap ?? {};

  const checkupPlanMap = data?.checkupPlanMap ?? {};
  const adminMap = data?.adminMap ?? {};
  const loading = isFetching && !data;
  const load = () => {
    queryClient.invalidateQueries({ queryKey: ['company', 'remittance'] });
    refetch();
  };

  const confirm = async (order: Order) => {
    if (busyId) return;
    setBusyId(order.id);
    try {
      const { data, error } = await supabase.functions.invoke('confirm-remittance', { body: { orderId: order.id } });
      const errMsg = error?.message || (data as any)?.error;
      if (errMsg) {
        // 重複點擊 / 狀態已改變：當成資訊提示，不是錯誤
        const alreadyProcessed = /not pending|already|not found/i.test(String(errMsg));
        if (alreadyProcessed) {
          toast({ title: '此訂單已被處理', description: '可能已由其他操作完成，正在重新整理列表' });
          load();
          return;
        }
        toast({ title: '確認失敗', description: errMsg, variant: 'destructive' });
        return;
      }
      await logAdminAction({
        action: 'remittance.confirm',
        targetType: 'remittance_orders',
        targetId: order.id,
        detail: {
          before: { status: order.status },
          after: { status: 'confirmed' },
          context: { payer_name: order.payer_name, amount: order.amount, last5: order.last5 },
        },
      });
      toast({ title: '已確認入帳', description: '訂閱已啟用' });
      load();
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (order: Order) => {
    const reason = rejectReason[order.id] || '';
    if (!reason.trim()) {
      toast({ title: '請填寫拒絕原因', variant: 'destructive' });
      return;
    }
    const { error } = await supabase.from('remittance_orders').update({
      status: 'rejected',
      reject_reason: reason,
      confirmed_by: (await supabase.auth.getUser()).data.user?.id,
      confirmed_at: new Date().toISOString(),
    }).eq('id', order.id);
    if (error) toast({ title: '拒絕失敗', description: error.message, variant: 'destructive' });
    else {
      await logAdminAction({
        action: 'remittance.reject',
        targetType: 'remittance_orders',
        targetId: order.id,
        detail: {
          before: { status: order.status },
          after: { status: 'rejected', reject_reason: reason },
          context: { payer_name: order.payer_name, amount: order.amount, reason },
        },
      });
      toast({ title: '已拒絕' }); load();
    }
  };

  const fmtDateTime = (s: string | null) => {
    if (!s) return '—';
    const d = new Date(s);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  return (
    <CompanyLayout>
      <SEO title={'匯款管理 | legendflow'} description={'匯款訂單審核與對帳。'} path={'/company/remittance'} noindex />
      <div className="p-6 max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">匯款審核</h1>
          <div className="flex gap-2 flex-wrap">
            {(['awaiting_info', 'pending', 'confirmed', 'rejected', 'expired', 'all'] as const).map(s => (
              <Button key={s} variant={filter === s ? 'default' : 'outline'} size="sm" onClick={() => setFilter(s)}>
                {s === 'awaiting_info' ? '待補資料'
                  : s === 'pending' ? '待對帳'
                  : s === 'confirmed' ? '已開通'
                  : s === 'rejected' ? '已拒絕'
                  : s === 'expired' ? '已過期'
                  : '全部'}
              </Button>
            ))}
          </div>
        </div>

        {loading ? <div className="text-muted-foreground">載入中…</div> : orders.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">無資料</Card>
        ) : orders.map(o => {
          const planName = o.product_kind === 'checkup_plan'
            ? (o.checkup_plan_id ? checkupPlanMap[o.checkup_plan_id] : null)
            : (o.plan_id ? planMap[o.plan_id] : null);
          const hasDiscount = o.original_amount && o.discount_amount && o.discount_amount > 0;
          return (
            <Card key={o.id} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={
                      o.status === 'pending' ? 'secondary'
                        : o.status === 'confirmed' ? 'default'
                        : o.status === 'rejected' ? 'destructive'
                        : o.status === 'expired' ? 'outline'
                        : 'outline'
                    } className={o.status === 'expired' ? 'text-muted-foreground' : ''}>
                      {o.status === 'awaiting_info' ? '待補資料'
                        : o.status === 'pending' ? '待對帳'
                        : o.status === 'confirmed' ? '已開通'
                        : o.status === 'rejected' ? '已拒絕'
                        : o.status === 'expired' ? '已過期'
                        : o.status}
                    </Badge>
                    <Badge variant="outline">{o.product_kind === 'checkup_plan' ? '健檢' : '專家方案'}</Badge>
                    <Badge variant="outline">{o.billing_cycle === 'yearly' ? '年費' : '月費'}</Badge>
                    {planName && <Badge variant="secondary">{planName}</Badge>}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">訂單 ID：{o.id}</div>
                  <div>付款人：<b>{o.payer_name ?? '—'}</b> ・ 末五碼：<b className="font-mono">{o.last5 ?? '—'}</b></div>
                  <div>
                    {hasDiscount ? (
                      <>
                        原價：<span className="line-through text-muted-foreground">NT$ {Number(o.original_amount).toLocaleString()}</span>
                        {' → '}
                        <b>NT$ {o.amount.toLocaleString()}</b>
                        <span className="text-xs text-muted-foreground ml-2">
                          (折抵 NT$ {Number(o.discount_amount).toLocaleString()}{o.discount_reason ? `・${o.discount_reason}` : ''})
                        </span>
                      </>
                    ) : (
                      <>金額：<b>NT$ {o.amount.toLocaleString()}</b></>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">建立：{fmtDateTime(o.created_at)}</div>
                  {o.status === 'confirmed' && o.confirmed_at && (
                    <div className="text-xs text-muted-foreground">
                      確認：{fmtDateTime(o.confirmed_at)}
                      {o.confirmed_by && adminMap[o.confirmed_by] ? ` ・由 ${adminMap[o.confirmed_by]}` : ''}
                    </div>
                  )}
                  {o.reject_reason && <div className="text-xs text-destructive">拒絕原因：{o.reject_reason}</div>}
                </div>
                {o.status === 'pending' && (
                  <div className="flex flex-col gap-2 w-64 shrink-0">
                    <Button size="sm" onClick={() => confirm(o)} disabled={busyId === o.id}>{busyId === o.id ? '處理中…' : '確認入帳並啟用訂閱'}</Button>
                    <Input
                      placeholder="拒絕原因…"
                      value={rejectReason[o.id] || ''}
                      onChange={e => setRejectReason(p => ({ ...p, [o.id]: e.target.value }))}
                    />
                    <Button size="sm" variant="destructive" onClick={() => reject(o)}>拒絕</Button>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </CompanyLayout>
  );
}
