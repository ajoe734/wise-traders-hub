import { useEffect, useState } from 'react';
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
  last5: string;
  payer_name: string;
  status: string;
  created_at: string;
  reject_reason: string | null;
}

export default function CompanyRemittance() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'awaiting_info' | 'pending' | 'confirmed' | 'rejected' | 'expired' | 'all'>('pending');
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    let q = supabase.from('remittance_orders').select('*').order('created_at', { ascending: false });
    if (filter !== 'all') q = q.eq('status', filter);
    const { data, error } = await q;
    if (error) toast({ title: '載入失敗', description: error.message, variant: 'destructive' });
    else setOrders((data || []) as Order[]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  const confirm = async (order: Order) => {
    const { data, error } = await supabase.functions.invoke('confirm-remittance', {
      body: { orderId: order.id },
    });
    if (error || (data as any)?.error) {
      toast({ title: '確認失敗', description: error?.message || (data as any)?.error, variant: 'destructive' });
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

  return (
    <CompanyLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">匯款審核</h1>
          <div className="flex gap-2">
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
        ) : orders.map(o => (
          <Card key={o.id} className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant={
                    o.status === 'pending' ? 'secondary'
                      : o.status === 'confirmed' ? 'default'
                      : o.status === 'rejected' ? 'destructive'
                      : 'outline'
                  }>
                    {o.status === 'awaiting_info' ? '待補資料'
                      : o.status === 'pending' ? '待對帳'
                      : o.status === 'confirmed' ? '已開通'
                      : o.status === 'rejected' ? '已拒絕'
                      : o.status === 'expired' ? '已過期'
                      : o.status}
                  </Badge>
                  <Badge variant="outline">{o.product_kind === 'checkup_plan' ? '健檢' : '專家方案'}</Badge>
                  <Badge variant="outline">{o.billing_cycle === 'yearly' ? '年費' : '月費'}</Badge>
                </div>
                <div className="font-mono text-xs text-muted-foreground">訂單 ID：{o.id}</div>
                <div>付款人：<b>{o.payer_name ?? '—'}</b> ・ 末五碼：<b className="font-mono">{o.last5 ?? '—'}</b></div>
                <div>金額：<b>NT$ {o.amount.toLocaleString()}</b></div>
                <div className="text-xs text-muted-foreground">建立：{new Date(o.created_at).toLocaleString('zh-TW')}</div>
                {o.reject_reason && <div className="text-xs text-destructive">拒絕原因：{o.reject_reason}</div>}
              </div>
              {o.status === 'pending' && (
                <div className="flex flex-col gap-2 w-64 shrink-0">
                  <Button size="sm" onClick={() => confirm(o)}>確認入帳並啟用訂閱</Button>
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
        ))}
      </div>
    </CompanyLayout>
  );
}
