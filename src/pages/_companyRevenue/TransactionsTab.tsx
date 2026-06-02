import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TabsContent } from '@/components/ui/tabs';
import { Download, Search, Undo2 } from 'lucide-react';
import { exportCSV, fmtDateTime, fmtMoney } from './utils';

interface Props {
  txMerged: any[];
  onRefund: (r: any) => void;
}

export function TransactionsTab({ txMerged, onRefund }: Props) {
  const [txSearch, setTxSearch] = useState('');
  const [txStatus, setTxStatus] = useState<'all' | 'paid' | 'refunded' | 'pending' | 'failed'>('all');
  const filteredTx = useMemo(() => {
    return txMerged.filter((r: any) => {
      if (txStatus !== 'all' && r.status !== txStatus) return false;
      if (txSearch.trim()) {
        const q = txSearch.trim().toLowerCase();
        if (
          !r.buyer_name.toLowerCase().includes(q) &&
          !(r.expert_name || '').toLowerCase().includes(q) &&
          !(r.product || '').toLowerCase().includes(q) &&
          !(r.provider_tx_id || '').toLowerCase().includes(q) &&
          !String(r.amount).includes(q)
        ) return false;
      }
      return true;
    });
  }, [txMerged, txSearch, txStatus]);

  return (
    <TabsContent value="transactions" className="mt-4 space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9 h-9" placeholder="搜尋訂閱者/專家/方案..." value={txSearch} onChange={e => setTxSearch(e.target.value)} />
        </div>
        <Select value={txStatus} onValueChange={(v) => setTxStatus(v as any)}>
          <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部狀態</SelectItem>
            <SelectItem value="paid">已付款</SelectItem>
            <SelectItem value="refunded">已退款</SelectItem>
            <SelectItem value="pending">處理中</SelectItem>
            <SelectItem value="failed">失敗</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={() => {
            exportCSV(`transactions-${new Date().toISOString().slice(0, 10)}.csv`, [
              ['時間', '訂閱者', '產品', '專家', '原價', '折扣', '實收', '金流', '狀態', '交易編號'],
              ...filteredTx.map(r => [
                fmtDateTime(r.created_at),
                r.buyer_name, r.product, r.expert_name,
                r.original_amount || r.amount, r.discount || 0, r.amount,
                r.provider_label, r.status, r.provider_tx_id || r.id.slice(0, 8),
              ]),
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
                <th className="p-3">時間</th>
                <th className="p-3">訂閱者</th>
                <th className="p-3">產品</th>
                <th className="p-3">專家</th>
                <th className="p-3 text-right">原價</th>
                <th className="p-3 text-right">折扣</th>
                <th className="p-3 text-right">實收</th>
                <th className="p-3">金流</th>
                <th className="p-3">狀態</th>
                <th className="p-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredTx.length === 0 ? (
                <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">無資料</td></tr>
              ) : filteredTx.map(r => (
                <tr key={`${r.kind}-${r.id}`} className="border-b last:border-0">
                  <td className="p-3 text-xs whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                  <td className="p-3">{r.buyer_name}</td>
                  <td className="p-3 text-xs">{r.product}</td>
                  <td className="p-3">{r.expert_name}</td>
                  <td className="p-3 text-right">{fmtMoney(r.original_amount || r.amount)}</td>
                  <td className="p-3 text-right text-muted-foreground">{r.discount ? `-${fmtMoney(r.discount)}` : '-'}</td>
                  <td className="p-3 text-right font-medium">{fmtMoney(r.amount)}</td>
                  <td className="p-3"><Badge variant="outline" className="text-xs">{r.provider_label}</Badge></td>
                  <td className="p-3">
                    <Badge
                      variant={r.status === 'paid' ? 'default' : r.status === 'refunded' ? 'destructive' : 'secondary'}
                      className="text-xs"
                    >
                      {r.status === 'paid' ? '已付款' : r.status === 'refunded' ? '已退款' : r.status === 'pending' ? '處理中' : r.status === 'failed' ? '失敗' : r.status}
                    </Badge>
                  </td>
                  <td className="p-3">
                    {r.kind === 'card' && r.status === 'paid' && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-company hover:bg-company/10"
                        onClick={() => onRefund(r)}>
                        <Undo2 className="h-3.5 w-3.5 mr-1" />退款
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </TabsContent>
  );
}
