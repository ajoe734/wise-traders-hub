import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TabsContent } from '@/components/ui/tabs';
import { Download } from 'lucide-react';
import { exportCSV, fmtDate } from './utils';

interface Props {
  subscriptions: any[];
  experts: any[];
  planMap: Record<string, any>;
  expertMap: Record<string, any>;
  profileMap: Record<string, any>;
}

export function SubscriptionsTab({ subscriptions, experts, planMap, expertMap, profileMap }: Props) {
  const [subFilter, setSubFilter] = useState({ expert: 'all', role: 'all', status: 'all', autorenew: 'all' });
  const filteredSubs = useMemo(() => {
    return subscriptions.filter((s: any) => {
      const plan = planMap[s.plan_id];
      const exp = plan ? expertMap[plan.expert_id] : null;
      if (subFilter.expert !== 'all' && plan?.expert_id !== subFilter.expert) return false;
      if (subFilter.role !== 'all' && exp?.role !== subFilter.role) return false;
      if (subFilter.status !== 'all' && s.status !== subFilter.status) return false;
      if (subFilter.autorenew === 'on' && !s.auto_renew) return false;
      if (subFilter.autorenew === 'off' && s.auto_renew) return false;
      return true;
    });
  }, [subscriptions, subFilter, planMap, expertMap]);

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
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={() => {
            exportCSV(`subscriptions-${new Date().toISOString().slice(0, 10)}.csv`, [
              ['訂閱者', '方案', '專家', '角色', '週期', '狀態', '續訂模式', '起始日', '到期日'],
              ...filteredSubs.map(s => {
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
                <th className="p-3">續訂模式</th>
                <th className="p-3">起始日</th>
                <th className="p-3">到期日</th>
              </tr>
            </thead>
            <tbody>
              {filteredSubs.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">無資料</td></tr>
              ) : filteredSubs.map(s => {
                const plan = planMap[s.plan_id];
                const exp = plan ? expertMap[plan.expert_id] : null;
                const buyer = profileMap[s.user_id];
                return (
                  <tr key={s.id} className="border-b last:border-0">
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
                    <td className="p-3">{s.auto_renew ? '自動' : '手動'}</td>
                    <td className="p-3">{fmtDate(s.started_at)}</td>
                    <td className="p-3">{fmtDate(s.expires_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </TabsContent>
  );
}
