import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TabsContent } from '@/components/ui/tabs';
import { Download } from 'lucide-react';
import { exportCSV, fmtDate } from './utils';
import { providerTypeLabels } from '@/hooks/useRevenueData';

interface Props {
  subscriptions: any[];
  experts: any[];
  planMap: Record<string, any>;
  expertMap: Record<string, any>;
  profileMap: Record<string, any>;
  /** 已付款交易（已依期間篩選）。 */
  transactions: any[];
  /** 匯款申請（已依期間篩選）。 */
  remittance: any[];
  providerMap: Record<string, any>;
  /** 期間篩選。 */
  range?: { from: Date; to: Date };
}

interface PayRow {
  paidAt: string | null;
  method: string;
  amount: number | null;
}

export function SubscriptionsTab({
  subscriptions, experts, planMap, expertMap, profileMap,
  transactions, remittance, providerMap, range,
}: Props) {
  const [subFilter, setSubFilter] = useState({ expert: 'all', role: 'all', status: 'all', autorenew: 'all' });
  const [includeCrossMonth, setIncludeCrossMonth] = useState(false);

  // 匯款確認後會另寫一筆 payment_transactions（同 subscription_id），申請紀錄不可再計一次。
  const paidTxSubIds = useMemo(() => new Set(
    transactions.filter((t: any) => t.status === 'paid' && t.subscription_id).map((t: any) => t.subscription_id),
  ), [transactions]);

  // subscription_id → 付款明細列
  const paymentsBySub = useMemo(() => {
    const map: Record<string, PayRow[]> = {};
    const push = (subId: string, row: PayRow) => {
      if (!map[subId]) map[subId] = [];
      map[subId].push(row);
    };
    transactions.filter((t: any) => t.status === 'paid' && t.subscription_id).forEach((t: any) => {
      const prov = providerMap[t.provider_id];
      push(t.subscription_id, {
        paidAt: t.paid_at || t.created_at,
        method: prov ? (providerTypeLabels[prov.provider_type] || prov.display_name) : '其他',
        amount: t.amount ?? null,
      });
    });
    remittance.forEach((r: any) => {
      if (r.status !== 'confirmed' || !r.subscription_id) return;
      if (paidTxSubIds.has(r.subscription_id)) return; // 已有正式付款紀錄
      push(r.subscription_id, {
        paidAt: r.confirmed_at || r.created_at,
        method: '匯款',
        amount: r.amount ?? null,
      });
    });
    Object.values(map).forEach(rows => rows.sort((a, b) =>
      new Date(a.paidAt || 0).getTime() - new Date(b.paidAt || 0).getTime()));
    return map;
  }, [transactions, remittance, providerMap, paidTxSubIds]);

  const filteredSubs = useMemo(() => {
    const from = range?.from.getTime();
    const to = range?.to.getTime();
    return subscriptions.filter((s: any) => {
      if (from != null && to != null) {
        if (includeCrossMonth) {
          // 訂閱期間與區間有重疊即列出
          const st = s.started_at ? new Date(s.started_at).getTime() : NaN;
          const ex = s.expires_at ? new Date(s.expires_at).getTime() : Infinity;
          if (Number.isFinite(st) && st > to) return false;
          if (ex < from) return false;
        } else {
          // 只列付款日落在區間內的訂閱；無付款紀錄的不列
          const pays = paymentsBySub[s.id] || [];
          if (!pays.some(p => {
            if (!p.paidAt) return false;
            const t = new Date(p.paidAt).getTime();
            return t >= from && t <= to;
          })) return false;
        }
      }
      const plan = planMap[s.plan_id];
      const exp = plan ? expertMap[plan.expert_id] : null;
      if (subFilter.expert !== 'all' && plan?.expert_id !== subFilter.expert) return false;
      if (subFilter.role !== 'all' && exp?.role !== subFilter.role) return false;
      if (subFilter.status !== 'all' && s.status !== subFilter.status) return false;
      if (subFilter.autorenew === 'on' && !s.auto_renew) return false;
      if (subFilter.autorenew === 'off' && s.auto_renew) return false;
      return true;
    });
  }, [subscriptions, subFilter, planMap, expertMap, range, includeCrossMonth, paymentsBySub]);

  // 展開成「一筆付款一列」；無付款紀錄的訂閱保留一列（付款欄位顯示 —）
  const rows = useMemo(() => {
    const from = range?.from.getTime();
    const to = range?.to.getTime();
    const out: { sub: any; pay: PayRow | null }[] = [];
    filteredSubs.forEach((s: any) => {
      let pays = paymentsBySub[s.id] || [];
      if (!includeCrossMonth && from != null && to != null) {
        pays = pays.filter(p => {
          if (!p.paidAt) return false;
          const t = new Date(p.paidAt).getTime();
          return t >= from && t <= to;
        });
      }
      if (pays.length === 0) out.push({ sub: s, pay: null });
      else pays.forEach(p => out.push({ sub: s, pay: p }));
    });
    return out;
  }, [filteredSubs, paymentsBySub, includeCrossMonth, range]);

  const subtotal = useMemo(() => ({
    count: rows.filter(r => r.pay).length,
    amount: rows.reduce((a, r) => a + (r.pay?.amount || 0), 0),
  }), [rows]);

  const fmtMoney = (n: number | null) => n == null ? '—' : `NT$${n.toLocaleString()}`;

  return (
    <TabsContent value="subscriptions" className="mt-4 space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={subFilter.expert} onValueChange={(v) => setSubFilter(s => ({ ...s, expert: v }))}>
          <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="全部專家" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部專家</SelectItem>
            {experts.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={subFilter.role} onValueChange={(v) => setSubFilter(s => ({ ...s, role: v }))}>
          <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部角色</SelectItem>
            <SelectItem value="advisor">分析師</SelectItem>
            <SelectItem value="mentor">實戰導師</SelectItem>
          </SelectContent>
        </Select>
        <Select value={subFilter.status} onValueChange={(v) => setSubFilter(s => ({ ...s, status: v }))}>
          <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部狀態</SelectItem>
            <SelectItem value="active">啟用</SelectItem>
            <SelectItem value="cancelled">已取消</SelectItem>
            <SelectItem value="expired">已到期</SelectItem>
          </SelectContent>
        </Select>
        <Select value={subFilter.autorenew} onValueChange={(v) => setSubFilter(s => ({ ...s, autorenew: v }))}>
          <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="off">手動續訂</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <Checkbox
            checked={includeCrossMonth}
            onCheckedChange={(v) => setIncludeCrossMonth(v === true)}
            data-testid="include-cross-month"
          />
          包含跨月訂閱
        </label>
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={() => {
            exportCSV(`subscriptions-${new Date().toISOString().slice(0, 10)}.csv`, [
              ['訂閱者', '方案', '專家', '角色', '週期', '狀態', '續訂模式', '起始日', '到期日', '付款日', '付款方式', '實付金額'],
              ...rows.map(({ sub: s, pay }) => {
                const plan = planMap[s.plan_id];
                const exp = plan ? expertMap[plan.expert_id] : null;
                const buyer = profileMap[s.user_id];
                return [
                  buyer?.display_name || '-',
                  plan?.name || '-',
                  exp?.name || '-',
                  exp?.role === 'mentor' ? '導師' : '分析師',
                  s.billing_cycle === 'yearly' ? '年' : '月',
                  s.status,
                  s.auto_renew ? '自動' : '手動',
                  fmtDate(s.started_at),
                  fmtDate(s.expires_at),
                  pay?.paidAt ? fmtDate(pay.paidAt) : '—',
                  pay?.method || '—',
                  pay?.amount ?? '—',
                ];
              }),
            ]);
          }}>
            <Download className="h-4 w-4 mr-2" />匯出
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="p-3">訂閱者</th>
                <th className="p-3">方案</th>
                <th className="p-3">專家</th>
                <th className="p-3">週期</th>
                <th className="p-3">狀態</th>
                <th className="p-3">起始日</th>
                <th className="p-3">到期日</th>
                <th className="p-3">付款日</th>
                <th className="p-3">付款方式</th>
                <th className="p-3 text-right">實付金額</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">無資料</td></tr>
              ) : rows.map(({ sub: s, pay }, i) => {
                const plan = planMap[s.plan_id];
                const exp = plan ? expertMap[plan.expert_id] : null;
                const buyer = profileMap[s.user_id];
                return (
                  <tr key={`${s.id}-${i}`} className="border-b last:border-0">
                    <td className="p-3">{buyer?.display_name || '-'}</td>
                    <td className="p-3">{plan?.name || '-'}</td>
                    <td className="p-3">
                      {exp ? (
                        <span className="inline-flex items-center gap-2">
                          {exp.name}
                          {exp.role === 'mentor' && <Badge className="bg-mentor text-white text-xs">導師</Badge>}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="p-3">{s.billing_cycle === 'yearly' ? '年' : '月'}</td>
                    <td className="p-3">
                      <Badge variant={s.status === 'active' ? 'default' : 'outline'} className="text-xs">{s.status}</Badge>
                    </td>
                    <td className="p-3">{fmtDate(s.started_at)}</td>
                    <td className="p-3">{fmtDate(s.expires_at)}</td>
                    <td className="p-3">{pay?.paidAt ? fmtDate(pay.paidAt) : '—'}</td>
                    <td className="p-3">
                      {pay ? pay.method : <Badge variant="outline" className="text-xs">無付款紀錄</Badge>}
                    </td>
                    <td className="p-3 text-right">{fmtMoney(pay?.amount ?? null)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/40 text-sm font-medium">
                <td className="p-3" colSpan={9}>小計（{subtotal.count} 筆付款）</td>
                <td className="p-3 text-right" data-testid="subs-subtotal">{fmtMoney(subtotal.amount)}</td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>
    </TabsContent>
  );
}
