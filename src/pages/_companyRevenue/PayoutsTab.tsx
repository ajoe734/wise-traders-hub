import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TabsContent } from '@/components/ui/tabs';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import { exportCSV, fmtDate, fmtMoney, ruleSourceLabels } from './utils';

interface Props {
  expertPayouts: any[];
  splitsByExpert: Record<string, any[]>;
  planMap: Record<string, any>;
}

export function PayoutsTab({ expertPayouts, splitsByExpert, planMap }: Props) {
  const [expandedExpert, setExpandedExpert] = useState<string | null>(null);

  return (
    <TabsContent value="payouts" className="mt-4 space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">本期應分給每位專家的金額（從 revenue_splits 聚合，不含退款）</p>
        <Button variant="outline" size="sm" onClick={() => {
          exportCSV(`expert-payouts-${new Date().toISOString().slice(0, 10)}.csv`, [
            ['專家', '角色', '筆數', '毛收', '折扣', '淨收', '平台', '專家應分'],
            ...expertPayouts.map(p => [
              p.expertInfo?.name || p.expert_id,
              p.expertInfo?.role === 'mentor' ? '導師' : '分析師',
              p.count, p.gross, p.discount, p.net, p.platform, p.expert_amount,
            ]),
          ]);
        }}>
          <Download className="h-4 w-4 mr-2" />匯出
        </Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="p-3 w-8"></th>
                <th className="p-3">專家</th>
                <th className="p-3 text-right">筆數</th>
                <th className="p-3 text-right">毛收</th>
                <th className="p-3 text-right">折扣</th>
                <th className="p-3 text-right">淨收</th>
                <th className="p-3 text-right">平台</th>
                <th className="p-3 text-right">專家應分</th>
              </tr>
            </thead>
            <tbody>
              {expertPayouts.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">本期尚無專家分潤紀錄</td></tr>
              ) : expertPayouts.map(p => {
                const open = expandedExpert === p.expert_id;
                const detail = splitsByExpert[p.expert_id] || [];
                return (
                  <>
                    <tr key={p.expert_id} className="border-b cursor-pointer hover:bg-muted/40"
                        onClick={() => setExpandedExpert(open ? null : p.expert_id)}>
                      <td className="p-3">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                      <td className="p-3">
                        <span className="inline-flex items-center gap-2">
                          {p.expertInfo?.name || p.expert_id.slice(0, 8)}
                          {p.expertInfo?.role === 'mentor' && <Badge className="bg-mentor text-white text-xs">導師</Badge>}
                        </span>
                      </td>
                      <td className="p-3 text-right">{p.count}</td>
                      <td className="p-3 text-right">{fmtMoney(p.gross)}</td>
                      <td className="p-3 text-right text-muted-foreground">-{fmtMoney(p.discount)}</td>
                      <td className="p-3 text-right">{fmtMoney(p.net)}</td>
                      <td className="p-3 text-right">{fmtMoney(p.platform)}</td>
                      <td className="p-3 text-right font-medium text-primary">{fmtMoney(p.expert_amount)}</td>
                    </tr>
                    {open && (
                      <tr key={`${p.expert_id}-detail`} className="bg-muted/20">
                        <td colSpan={8} className="p-3">
                          <ScrollArea className="max-h-[320px]">
                            <div className="overflow-x-auto"><table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-muted-foreground">
                                  <th className="p-2">日期</th>
                                  <th className="p-2">方案</th>
                                  <th className="p-2 text-right">毛收</th>
                                  <th className="p-2 text-right">折扣</th>
                                  <th className="p-2 text-right">淨收</th>
                                  <th className="p-2 text-right">平台</th>
                                  <th className="p-2 text-right">專家</th>
                                  <th className="p-2">規則來源</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.map(d => (
                                  <tr key={d.id} className="border-t border-border/40">
                                    <td className="p-2 whitespace-nowrap">{fmtDate(d.created_at)}</td>
                                    <td className="p-2">{planMap[d.plan_id]?.name || '-'}</td>
                                    <td className="p-2 text-right">{fmtMoney(d.gross)}</td>
                                    <td className="p-2 text-right">-{fmtMoney(d.discount)}</td>
                                    <td className="p-2 text-right">{fmtMoney(d.net)}</td>
                                    <td className="p-2 text-right">{fmtMoney(d.platform_amount)}</td>
                                    <td className="p-2 text-right text-primary">{fmtMoney(d.expert_amount)}</td>
                                    <td className="p-2"><Badge variant="outline" className="text-xs">{ruleSourceLabels[d.rule_source] || d.rule_source}</Badge></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table></div>
                          </ScrollArea>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table></div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}
