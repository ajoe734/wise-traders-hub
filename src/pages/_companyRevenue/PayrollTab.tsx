import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { computePayroll, payDate, prevMonth, taipeiMonth, type PayrollRow } from '@/lib/expertPayroll';
import { fmtDate, fmtMoney } from './utils';

const monthLabel = (m: string) => m.replace('-', '/');

export function PayrollTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const current = taipeiMonth(new Date().toISOString());
  const [month, setMonth] = useState(prevMonth(current));
  const [unmarking, setUnmarking] = useState<PayrollRow | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['company', 'payroll'],
    staleTime: 30_000,
    queryFn: async () => {
      const [sp, tx, sub, exp, lk, au] = await Promise.all([
        supabase.from('revenue_splits').select('transaction_id, expert_id, expert_amount, net, platform_amount'),
        supabase.from('payment_transactions').select('id, status, paid_at, created_at, subscription_id, amount'),
        supabase.from('member_subscriptions').select('id, user_id'),
        supabase.from('experts').select('id, name, role'),
        supabase.from('expert_payouts').select('*'),
        supabase.from('audit_logs').select('target_id, created_at').eq('action', 'payment.refund'),
      ]);
      const err = sp.error || tx.error || sub.error || exp.error || lk.error || au.error;
      if (err) throw err;
      const refundAt: Record<string, string> = {};
      for (const a of au.data || []) if (a.target_id && (!refundAt[a.target_id] || a.created_at < refundAt[a.target_id])) refundAt[a.target_id] = a.created_at;
      const subUser: Record<string, string> = {};
      for (const s of sub.data || []) subUser[s.id] = s.user_id;
      return { splits: sp.data || [], txs: tx.data || [], refundAt, subUser, experts: exp.data || [], locks: lk.data || [] };
    },
  });

  const payroll = useMemo(() => data
    ? computePayroll(data.splits as any, data.txs as any, data.refundAt, data.subUser, data.locks as any, current)
    : {}, [data, current]);

  const months = useMemo(() => {
    const set = new Set<string>([prevMonth(current), current]);
    for (const e of Object.values(payroll)) for (const m of Object.keys(e)) set.add(m);
    return [...set].sort().reverse();
  }, [payroll, current]);

  const expertMap = useMemo(() => new Map((data?.experts || []).map((e: any) => [e.id, e])), [data]);
  const rows = Object.values(payroll).map((e) => e[month]).filter(Boolean)
    .filter((r) => r.locked || r.amount !== 0 || r.tx_count > 0 || r.clawback > 0)
    .sort((a, b) => b.amount - a.amount);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const unpaidTotal = rows.filter((r) => !r.locked).reduce((s, r) => s + r.amount, 0);
  const isOpenMonth = month >= current;

  const markPaid = async (r: PayrollRow) => {
    setBusy(true);
    const now = new Date().toISOString();
    const { error } = await supabase.from('expert_payouts').upsert({
      expert_id: r.expert_id, period_month: r.month, earnings: r.earnings, clawback: r.clawback,
      carry_in: r.carry_in, amount: r.amount, net: r.net, platform_amount: r.platform_amount,
      tx_count: r.tx_count, student_count: r.student_count, clawback_items: r.clawbackItems as any, status: 'paid', paid_at: now,
      paid_by: user?.id ?? null, unmark_reason: null, updated_at: now,
    }, { onConflict: 'expert_id,period_month' });
    if (!error) await supabase.from('audit_logs').insert({
      action: 'payroll.mark_paid', actor_id: user?.id, target_type: 'expert_payouts', target_id: r.expert_id,
      detail: { month: r.month, amount: r.amount, clawback: r.clawback },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`已標記 ${monthLabel(r.month)} 發放`);
    qc.invalidateQueries({ queryKey: ['company', 'payroll'] });
  };

  const unmark = async () => {
    if (!unmarking || !reason.trim()) return;
    setBusy(true);
    const { error } = await supabase.from('expert_payouts').update({
      status: 'unmarked', unmark_reason: reason.trim(), updated_at: new Date().toISOString(),
    }).eq('expert_id', unmarking.expert_id).eq('period_month', unmarking.month);
    if (!error) await supabase.from('audit_logs').insert({
      action: 'payroll.unmark', actor_id: user?.id, target_type: 'expert_payouts', target_id: unmarking.expert_id,
      detail: { month: unmarking.month, reason: reason.trim(), amount: unmarking.amount },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('已取消發放標記');
    setUnmarking(null); setReason('');
    qc.invalidateQueries({ queryKey: ['company', 'payroll'] });
  };

  return (
    <TabsContent value="payroll" className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-[140px] h-9" aria-label="選擇月份"><SelectValue /></SelectTrigger>
          <SelectContent>{months.map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}</SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">發放日 {payDate(month)}</span>
        <span className="text-sm">總應發 <b className="text-foreground">{fmtMoney(total)}</b></span>
        {unpaidTotal !== total && <span className="text-sm text-muted-foreground">尚未發放 {fmtMoney(unpaidTotal)}</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        以付款成功時間（台北）歸月，年繳整筆算付款當月。已發放後才退款的金額，於下個月扣回；負數會延續到下月。
        {isOpenMonth && ' 本月尚未結束，數字仍會變動。'}
      </p>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">載入中…</p>
      ) : error ? (
        <div className="py-8 text-center space-y-2">
          <p className="text-sm text-destructive">讀取失敗</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>重試</Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">{monthLabel(month)} 沒有需要發放的分潤</p>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => {
            const e: any = expertMap.get(r.expert_id);
            return (
              <Card key={r.expert_id} data-testid="payroll-card">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-foreground truncate">{e?.name || r.expert_id.slice(0, 8)}</div>
                      <div className="text-xs text-muted-foreground">{e?.role === 'mentor' ? '實戰導師' : '投顧分析師'}</div>
                    </div>
                    {r.locked
                      ? <Badge variant="secondary">已發放 {fmtDate(r.paid_at)}</Badge>
                      : <Badge variant="outline">未發放</Badge>}
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">應發</div>
                    <div className={`text-[22px] font-medium ${r.amount < 0 ? 'text-destructive' : 'text-foreground'}`}>{fmtMoney(r.amount)}</div>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">學員／筆數</dt><dd className="text-right">{r.student_count} 人／{r.tx_count} 筆</dd>
                    <dt className="text-muted-foreground">當月分潤</dt><dd className="text-right">{fmtMoney(r.earnings)}</dd>
                    <dt className="text-muted-foreground">淨收／平台</dt><dd className="text-right">{fmtMoney(r.net)}／{fmtMoney(r.platform_amount)}</dd>
                    {r.clawback > 0 && (<>
                      <dt className="text-muted-foreground">退款扣回</dt>
                      <dd className="text-right text-destructive">−{fmtMoney(r.clawback)}（{r.clawbackItems.length || ''} 筆{r.clawbackItems[0] ? `，來自 ${[...new Set(r.clawbackItems.map((c) => monthLabel(c.fromMonth)))].join('、')}` : ''}）</dd>
                    </>)}
                    {r.carry_in < 0 && (<>
                      <dt className="text-muted-foreground">上月負額延續</dt><dd className="text-right text-destructive">{fmtMoney(r.carry_in)}</dd>
                    </>)}
                  </dl>
                  {r.locked ? (
                    <Button size="sm" variant="ghost" className="w-full" disabled={busy} onClick={() => setUnmarking(r)}>取消標記</Button>
                  ) : (
                    <Button size="sm" className="w-full" disabled={busy || isOpenMonth} onClick={() => markPaid(r)}
                      title={isOpenMonth ? '月份結束後才能標記發放' : undefined}>標記已發放</Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!unmarking} onOpenChange={(o) => { if (!o) { setUnmarking(null); setReason(''); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>取消 {unmarking && monthLabel(unmarking.month)} 發放標記</DialogTitle></DialogHeader>
          <Textarea placeholder="請填寫原因（會留存稽核紀錄）" value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnmarking(null)}>返回</Button>
            <Button disabled={busy || !reason.trim()} onClick={unmark}>確認取消</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TabsContent>
  );
}
